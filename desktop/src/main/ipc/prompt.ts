import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';
import {
  saveConversation,
  appendSessionChannelMessage,
  getRegisteredConnection,
} from '../database';
import { resolveOpenCodeSessionId } from '../session/resolver';

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
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  /** Unix ms timestamp when this prompt expires. 0 means no timeout. */
  expiresAt: number;
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
  /** OpenCode session ID resolved from the DB for this connectionId. */
  openCodeSessionId?: string | null;
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
// Map key strategy: prefer openCodeSessionId over connectionId.
// When an agent reconnects after a transport drop, it gets a new connectionId
// (new MCP transport UUID) but retains the same openCodeSessionId. Keying on
// openCodeSessionId ensures the reconnecting agent automatically re-attaches
// to the existing durable prompt state.
// ─────────────────────────────────────────────────────────────────────────────

type DurablePromptState = {
  promptId: string;
  data: PromptData;
  /** The stable map key used to store this state (openCodeSessionId ?? connectionId). */
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

/** One active durable prompt per connection (FIFO queue handles overflow). */
const activePrompts = new Map<string, DurablePromptState>();

/** Index active prompts by prompt ID for O(1) prompt-response dispatch. */
const activePromptStatesById = new Map<string, Set<DurablePromptState>>();

let promptResponseListenerRegistered = false;

/** FIFO queue per connection for prompts that arrive while one is active. */
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
// Internal: resolve the stable map key for a connectionId
// ─────────────────────────────────────────────────────────────────────────────

function resolvePromptKey(connectionId: string): string {
  const rc = getRegisteredConnection(connectionId);
  return rc?.openCodeSessionId ?? connectionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the PromptData for every currently-active prompt (one per connection).
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
 * Cancel and clean up any active prompt for a connection.
 * Call when a connection drops to avoid leaked listeners.
 */
export function cancelActivePrompt(connectionId: string): void {
  // Primary key via DB resolver (openCodeSessionId when known).
  // Fallback: scan all active prompts for matching MCP connectionId. This is
  // required when subagent prompts are keyed by openCodeSessionId but the DB
  // lookup is stale/missing during teardown.
  const keysToCancel = new Set<string>([resolvePromptKey(connectionId)]);
  for (const [key, state] of activePrompts.entries()) {
    if (state.data.connectionId === connectionId) {
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
      if (entry.connectionId !== connectionId) {
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
 * Force-terminate a chat for a connection. Resolves any pending prompt
 * with a termination message so the agent knows the user closed the chat.
 */
export function forceTerminateChat(connectionId: string): void {
  const terminationMessage =
    'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.';

  // Same resilient lookup strategy as cancelActivePrompt.
  const keysToTerminate = new Set<string>([resolvePromptKey(connectionId)]);
  for (const [key, state] of activePrompts.entries()) {
    if (state.data.connectionId === connectionId) {
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
      if (entry.connectionId !== connectionId) {
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
 * ## openCodeSessionId keying
 *
 * The active-prompt map is keyed on openCodeSessionId (when available) rather
 * than connectionId. This means a reconnecting agent with a new MCP transport
 * UUID (new connectionId) but the same OpenCode session automatically
 * re-attaches to its in-flight durable prompt.
 */
export function promptUser(
  win: BrowserWindow | null,
  data: PromptData,
  signal?: AbortSignal,
): Promise<PromptResponse> {
  // Resolve the stable key before enqueuing so the queue is also keyed
  // on openCodeSessionId when available.
  //
  // PRIORITY ORDER for promptKey:
  // 1. data.openCodeSessionId (explicitly passed by the agent on every tool call)
  // 2. DB lookup by connectionId (fallback for legacy/standalone clients)
  // 3. data.connectionId (final fallback)
  //
  // This ensures subagents route to their own channel, not the main agent's,
  // even though they share the same MCP connectionId (OpenCode uses a shared client).
  const resolvedSessionId = resolveOpenCodeSessionId(
    data.connectionId,
    data.openCodeSessionId,
  );
  const promptKey = resolvedSessionId ?? data.connectionId;

  // DEBUG: Log prompt routing resolution
  console.log(
    `[prompt-routing] promptUser called:\n` +
      `  data.connectionId=${data.connectionId}\n` +
      `  data.openCodeSessionId=${data.openCodeSessionId ?? 'undefined'}\n` +
      `  resolvedSessionId=${resolvedSessionId ?? 'null'}\n` +
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
          // Use the centralized resolver for consistent priority ordering
          openCodeSessionId: resolvedSessionId,
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
              connectionId: data.connectionId,
              openCodeSessionId: promptWithExpiry.openCodeSessionId ?? null,
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
        win.webContents.send('prompt-request', promptWithExpiry);
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

  // Use the stored promptKey (openCodeSessionId ?? connectionId) to find and
  // remove the correct map entry. This handles the case where the prompt was
  // keyed on openCodeSessionId and _settlePrompt is called without knowing
  // which connectionId was used originally.
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
