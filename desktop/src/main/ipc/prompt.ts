import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';
import { saveConversation, appendSessionChannelMessage } from '../database';

let _getSoundEnabled: () => boolean = () => true;
let _getPromptTimeoutMs: () => number = () => 1_200_000;

export function setSoundEnabled(fn: () => boolean): void {
  _getSoundEnabled = fn;
}

export function setPromptTimeout(fn: () => number): void {
  _getPromptTimeoutMs = fn;
}

export function getPromptTimeoutSeconds(): number {
  return Math.round(_getPromptTimeoutMs() / 1000);
}

export interface PromptData {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  /**
   * MCP transport handle. Still needed to track which transport a prompt
   * originated on so cancelActivePrompt/forceTerminateChat can sweep prompts
   * when that transport drops. NEVER used as the in-memory map key.
   */
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  /** Unix ms timestamp when this prompt expires. 0 means no timeout. */
  expiresAt: number;
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
  /**
   * Canonical provider-session identity. For OpenCode this equals the
   * `ses_xxx` session ID; for other providers it is the stable identity
   * captured at first registration. Callers MUST resolve this before invoking
   * `promptUser` — it is the key used for the activePrompts map and all
   * downstream routing.
   */
  providerSessionId: string | null;
}

export interface PromptResponse {
  answer: string | null;
  attachments?: {
    data: string;
    mimeType: string;
    name: string;
    size: number;
  }[];
}

export type PromptUserFn = (
  win: BrowserWindow | null,
  data: PromptData,
  signal?: AbortSignal,
) => Promise<PromptResponse>;

// ─────────────────────────────────────────────────────────────────────────────
// Durable prompt state
//
// A "durable prompt" lives in main-process memory independent of any HTTP
// connection. It is created the first time a tool call arrives for a given
// (promptKey, promptId) pair and is resolved exactly once — either by the
// user's reply, by a force-terminate, by a connection cancel, or by the
// per-prompt timeout.
//
// When the MCP transport's AbortSignal fires (TCP drop / agent-side timeout),
// we do NOT resolve the durable promise. Instead the tool handler simply
// awaits the same durable promise on the next retry, so the user's eventual
// reply is forwarded to the agent regardless of how many times the HTTP
// connection dropped while the user was thinking.
//
// Map key strategy: providerSessionId keying.
// When an agent reconnects after a transport drop, it gets a new connectionId
// (new MCP transport UUID) but retains the same providerSessionId. Keying on
// providerSessionId ensures the reconnecting agent automatically re-attaches
// to the existing durable prompt state.
// ─────────────────────────────────────────────────────────────────────────────

type DurablePromptState = {
  promptId: string;
  data: PromptData;
  /** The stable map key used to store this state (always a providerSessionId once Phase 3 lands). */
  promptKey: string;
  /** Resolves when the user replies, timeout fires, or the prompt is cancelled. */
  promise: Promise<PromptResponse>;
  resolve: (r: PromptResponse) => void;
  /** True once resolve() has been called. */
  settled: boolean;
  /** setTimeout handle for the per-prompt expiry timer. null = no timeout. */
  timer: ReturnType<typeof setTimeout> | null;
  /** setInterval handle for diagnostic logging. */
  diagInterval: ReturnType<typeof setInterval> | null;
  /** Sends prompt-clear to the renderer. Captured at creation time. */
  sendPromptClear: () => void;
};

/** One active durable prompt per providerSessionId (FIFO queue handles overflow). */
const activePrompts = new Map<string, DurablePromptState>();

/** Index active prompts by prompt ID for O(1) prompt-response dispatch. */
const activePromptStatesById = new Map<string, Set<DurablePromptState>>();

let promptResponseListenerRegistered = false;

/** FIFO queue per providerSessionId for prompts that arrive while one is active. */
const queuedPrompts = new Map<
  string,
  {
    run: () => Promise<void>;
    resolve: (r: PromptResponse) => void;
    connectionId: string;
  }[]
>();
const queueRunning = new Set<string>();

// Beep throttle
let lastBeepTime = 0;
const BEEP_COOLDOWN_MS = 2000;

/** Max safe setTimeout value — prevents Node integer overflow (~24.8 days). */
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

function trackPromptState(state: DurablePromptState): void {
  const existing = activePromptStatesById.get(state.promptId);
  if (existing) {
    existing.add(state);
    return;
  }
  activePromptStatesById.set(state.promptId, new Set([state]));
}

function untrackPromptState(state: DurablePromptState): void {
  const states = activePromptStatesById.get(state.promptId);
  if (!states) return;
  states.delete(state);
  if (states.size === 0) {
    activePromptStatesById.delete(state.promptId);
  }
}

function getIndexedPromptStateCount(): number {
  let count = 0;
  for (const states of activePromptStatesById.values()) {
    count += states.size;
  }
  return count;
}

function handlePromptResponse(
  _event: Electron.IpcMainEvent,
  response: {
    id: string;
    answer: string;
    attachments?: {
      data: string;
      mimeType: string;
      name: string;
      size: number;
    }[];
  },
): void {
  if (!response?.id) return;

  const states = activePromptStatesById.get(response.id);
  if (!states || states.size === 0) return;

  for (const state of Array.from(states)) {
    if (state.settled) continue;

    _settlePrompt(state, {
      answer: response.answer,
      attachments: response.attachments,
    });
    state.sendPromptClear();

    saveConversation({
      promptMessage: state.data.message,
      projectName: state.data.projectName,
      userResponse: response.answer,
      predefinedOptions: state.data.predefinedOptions,
      attachments: response.attachments,
    });
    appendSessionChannelMessage({
      sessionId: state.promptKey,
      messageType: 'answer',
      messageText: response.answer,
      attachments: response.attachments,
    });
  }
}

function ensurePromptResponseListener(): void {
  if (promptResponseListenerRegistered) return;
  ipcMain.on('prompt-response', handlePromptResponse);
  promptResponseListenerRegistered = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the PromptData for every currently-active prompt (one per providerSessionId).
 * Used by the renderer on startup to recover prompts that arrived while the
 * renderer was restarting (main-process memory survives renderer restarts).
 */
export function getActivePromptData(): PromptData[] {
  const result: PromptData[] = [];
  for (const state of activePrompts.values()) {
    result.push(state.data);
  }
  return result;
}

/** Test-only helper to reset in-memory prompt state. */
export function __resetPromptStateForTests(): void {
  for (const state of activePrompts.values()) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.diagInterval !== null) {
      clearInterval(state.diagInterval);
      state.diagInterval = null;
    }
  }

  activePrompts.clear();
  activePromptStatesById.clear();
  queuedPrompts.clear();
  queueRunning.clear();

  if (promptResponseListenerRegistered) {
    ipcMain.removeListener('prompt-response', handlePromptResponse);
    promptResponseListenerRegistered = false;
  }

  lastBeepTime = 0;
}

/**
 * Cancel and clean up any active prompt matching the given identity.
 *
 * The `identity` argument is opaque: it may be either an MCP transport
 * `connectionId` (when called from transport-drop paths in mcp-server.ts) or
 * a `providerSessionId` (when called from session-removal paths that only
 * know the canonical session id). We match against BOTH fields on each
 * active prompt so callers do not need to know which form they hold.
 *
 * For queued prompts, the map key IS the providerSessionId, and the queued
 * entry carries the originating connectionId — we match against both.
 */
export function cancelActivePrompt(identity: string): void {
  const keysToCancel = new Set<string>();
  for (const [key, state] of activePrompts.entries()) {
    if (
      state.data.connectionId === identity ||
      state.data.providerSessionId === identity ||
      key === identity
    ) {
      keysToCancel.add(key);
    }
  }

  for (const key of keysToCancel) {
    const state = activePrompts.get(key);
    if (!state) continue;
    state.sendPromptClear();
    _settlePrompt(state, {
      answer: 'Error: Prompt superseded by a newer prompt.',
    });
  }

  for (const [key, queued] of queuedPrompts.entries()) {
    if (!queued.length) {
      queuedPrompts.delete(key);
      continue;
    }

    const remaining: typeof queued = [];
    for (const entry of queued) {
      if (entry.connectionId !== identity && key !== identity) {
        remaining.push(entry);
        continue;
      }
      entry.resolve({
        answer:
          'Error: Prompt cancelled before display because the connection was closed.',
      });
    }

    if (remaining.length === 0) {
      queuedPrompts.delete(key);
      continue;
    }
    queuedPrompts.set(key, remaining);
  }
}

/**
 * Force-terminate a chat matching the given identity. See cancelActivePrompt
 * for the opaque-identity matching rules. Resolves any pending prompt with
 * a termination message so the agent knows the user closed the chat.
 */
export function forceTerminateChat(identity: string): void {
  const terminationMessage =
    'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.';

  const keysToTerminate = new Set<string>();
  for (const [key, state] of activePrompts.entries()) {
    if (
      state.data.connectionId === identity ||
      state.data.providerSessionId === identity ||
      key === identity
    ) {
      keysToTerminate.add(key);
    }
  }

  for (const key of keysToTerminate) {
    const state = activePrompts.get(key);
    if (!state) continue;
    _settlePrompt(state, { answer: terminationMessage });
  }

  for (const [key, queued] of queuedPrompts.entries()) {
    if (!queued.length) {
      queuedPrompts.delete(key);
      continue;
    }

    const remaining: typeof queued = [];
    for (const entry of queued) {
      if (entry.connectionId !== identity && key !== identity) {
        remaining.push(entry);
        continue;
      }
      entry.resolve({ answer: terminationMessage });
    }

    if (remaining.length === 0) {
      queuedPrompts.delete(key);
      continue;
    }
    queuedPrompts.set(key, remaining);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core prompt function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display a prompt to the user and return their answer.
 *
 * ## Transport-resilient design
 *
 * The returned Promise is backed by a *durable* in-process state object that
 * survives HTTP connection drops. When the MCP transport fires its AbortSignal
 * (TCP disconnect / agent-side timeout), this function does NOT resolve the
 * promise — it simply detaches from the signal and keeps waiting. When the
 * agent retries the same tool call (transparent reinit path in mcp-server.ts),
 * the tool handler calls promptUser() again. If a durable state already exists
 * for this promptKey, we return the same underlying Promise directly so the
 * retry sees the user's reply as soon as it arrives.
 *
 * This breaks the coupling between "HTTP connection alive" and "prompt active"
 * that caused the -32000 Connection closed errors.
 *
 * ## providerSessionId keying
 *
 * The active-prompt map is keyed on providerSessionId rather than connectionId.
 * This means a reconnecting agent with a new MCP transport UUID (new
 * connectionId) but the same provider session automatically re-attaches to
 * its in-flight durable prompt.
 *
 * CALLER CONTRACT: `data.providerSessionId` MUST be resolved before calling
 * this function. The resolver at the tool-call boundary is responsible for
 * converting the wire parameter `openCodeSessionId` (+ connectionId DB lookup)
 * into a canonical providerSessionId and storing it on PromptData.
 */
export function promptUser(
  win: BrowserWindow | null,
  data: PromptData,
  signal?: AbortSignal,
): Promise<PromptResponse> {
  // Phase 3: providerSessionId is now required on PromptData. The resolver at
  // the tool-call boundary is responsible for converting the wire parameter
  // `openCodeSessionId` (+ connectionId DB lookup) into a canonical
  // providerSessionId and storing it on PromptData. No connectionId fallback.
  const promptKey = data.providerSessionId ?? '';
  if (!promptKey) {
    return Promise.resolve({
      answer:
        'Error: providerSessionId could not be resolved — the agent session is not registered.',
    });
  }

  // DEBUG: Log prompt routing resolution
  console.log(
    `[prompt-routing] promptUser called:\n` +
      `  data.connectionId=${data.connectionId}\n` +
      `  data.providerSessionId=${data.providerSessionId ?? 'undefined'}\n` +
      `  resolved promptKey=${promptKey}`,
  );

  return new Promise<PromptResponse>((resolveOuter) => {
    _enqueuePrompt(promptKey, {
      connectionId: data.connectionId,
      resolve: resolveOuter,
      run: async () => {
        // If the AbortSignal is already fired before we even start, there is
        // no point displaying the prompt. Resolve with a lightweight error and
        // yield to the queue so the next prompt can run.
        if (signal?.aborted) {
          resolveOuter({
            answer:
              'Error: Tool call aborted — the MCP session was closed or the request was cancelled.',
          });
          return;
        }

        if (!win || win.isDestroyed()) {
          resolveOuter({
            answer: 'Error: Application window is not available.',
          });
          return;
        }

        // ── Check if a durable prompt is already active for this key ─────────
        // When the MCP transport drops and the agent retries, a new call to
        // promptUser() arrives. If there is already a live durable state we
        // attach to it rather than creating a new UI prompt.
        const existing = activePrompts.get(promptKey);
        if (existing && !existing.settled) {
          // Re-attach: forward the existing durable promise result to the
          // outer resolver of this new tool-call invocation.
          void existing.promise.then(resolveOuter);
          return;
        }

        // ── Create a new durable prompt state ────────────────────────────────
        win.show();
        win.focus();

        const now = Date.now();
        if (_getSoundEnabled() && now - lastBeepTime >= BEEP_COOLDOWN_MS) {
          lastBeepTime = now;
          shell.beep();
        }

        const timeoutMs = _getPromptTimeoutMs();
        const safeTimeoutMs =
          timeoutMs > 0 ? Math.min(timeoutMs, MAX_SAFE_TIMEOUT_MS) : 0;

        const promptWithExpiry: PromptData = {
          ...data,
          expiresAt: timeoutMs > 0 ? now + timeoutMs : 0,
          providerSessionId: data.providerSessionId ?? null,
        };

        // Create the durable state object. We need a two-step construction
        // because ipcHandler and state reference each other.
        let durableResolve!: (r: PromptResponse) => void;
        const durablePromise = new Promise<PromptResponse>((res) => {
          durableResolve = res;
        });

        const sendPromptClear = (): void => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('prompt-clear', {
              id: data.id,
              providerSessionId: promptWithExpiry.providerSessionId ?? null,
            });
          }
        };

        const durableState: DurablePromptState = {
          promptId: data.id,
          data: promptWithExpiry,
          promptKey,
          promise: durablePromise,
          resolve: durableResolve,
          settled: false,
          timer: null,
          diagInterval: null,
          sendPromptClear,
        };

        ensurePromptResponseListener();
        activePrompts.set(promptKey, durableState);
        trackPromptState(durableState);

        // Forward durable promise to the outer resolver of THIS call
        void durablePromise.then(resolveOuter);

        // ── Send prompt to renderer ───────────────────────────────────────────
        // connectionId is intentionally NOT included in the renderer payload
        // — it is an internal transport handle only.
        win.webContents.send('prompt-request', {
          id: promptWithExpiry.id,
          message: promptWithExpiry.message,
          projectName: promptWithExpiry.projectName,
          predefinedOptions: promptWithExpiry.predefinedOptions,
          sessionId: promptWithExpiry.sessionId,
          connectionName: promptWithExpiry.connectionName,
          timeoutSeconds: promptWithExpiry.timeoutSeconds,
          expiresAt: promptWithExpiry.expiresAt,
          baseDirectory: promptWithExpiry.baseDirectory,
          clientInfo: promptWithExpiry.clientInfo,
          providerSessionId: promptWithExpiry.providerSessionId,
        });
        appendSessionChannelMessage({
          sessionId: promptKey,
          messageType: 'question',
          messageText: data.message,
        });

        // ── Diagnostic polling ────────────────────────────────────────────────
        const diagStart = Date.now();
        durableState.diagInterval = setInterval(() => {
          if (durableState.settled) {
            clearInterval(durableState.diagInterval!);
            durableState.diagInterval = null;
            return;
          }
          const elapsed = Math.round((Date.now() - diagStart) / 1000);
          const listenerCount = ipcMain.listenerCount('prompt-response');
          const indexedPromptIds = activePromptStatesById.size;
          const indexedPromptStates = getIndexedPromptStateCount();
          console.log(
            `[prompt-diag] id=${data.id} connectionId=${data.connectionId} promptKey=${promptKey} ` +
              `settled=${durableState.settled} elapsed=${elapsed}s ` +
              `prompt-response-listeners=${listenerCount} ` +
              `activePrompts=${activePrompts.size} ` +
              `indexedPromptIds=${indexedPromptIds} ` +
              `indexedPromptStates=${indexedPromptStates}`,
          );
        }, 10_000);

        // ── Per-prompt expiry timer ───────────────────────────────────────────
        // The timer is intentionally NOT cancelled when the AbortSignal fires.
        // The prompt stays alive across transport reconnects; only the
        // user-configured timeout or an explicit cancel/terminate ends it.
        if (safeTimeoutMs > 0) {
          durableState.timer = setTimeout(() => {
            const state = activePrompts.get(promptKey);
            if (!state || state.settled) return;
            _settlePrompt(state, { answer: null as unknown as string });
            appendSessionChannelMessage({
              sessionId: promptKey,
              messageType: 'agent_message',
              messageText:
                'Prompt expired before a reply was submitted. Ask again to continue this interaction.',
            });
            sendPromptClear();
          }, safeTimeoutMs);
        }
      },
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Settle a durable prompt: resolve its promise, clean up timers and listeners,
 * and remove it from the activePrompts map.
 */
function _settlePrompt(
  state: DurablePromptState,
  response: PromptResponse,
): void {
  if (state.settled) return;
  state.settled = true;

  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.diagInterval !== null) {
    clearInterval(state.diagInterval);
    state.diagInterval = null;
  }

  // Use the stored promptKey (providerSessionId) to find and remove the
  // correct map entry.
  const current = activePrompts.get(state.promptKey);
  if (current && current.promptId === state.promptId) {
    activePrompts.delete(state.promptKey);
  }

  untrackPromptState(state);

  state.resolve(response);
}

function _enqueuePrompt(
  promptKey: string,
  entry: {
    run: () => Promise<void>;
    resolve: (r: PromptResponse) => void;
    connectionId: string;
  },
): void {
  const queue = queuedPrompts.get(promptKey);
  if (queue) {
    queue.push(entry);
  } else {
    queuedPrompts.set(promptKey, [entry]);
  }
  void _processQueue(promptKey);
}

async function _processQueue(promptKey: string): Promise<void> {
  if (queueRunning.has(promptKey)) return;
  queueRunning.add(promptKey);

  try {
    while (true) {
      const queue = queuedPrompts.get(promptKey);
      if (!queue?.length) {
        queuedPrompts.delete(promptKey);
        return;
      }
      const next = queue.shift();
      if (!next) return;
      await next.run();
    }
  } finally {
    queueRunning.delete(promptKey);
  }
}
