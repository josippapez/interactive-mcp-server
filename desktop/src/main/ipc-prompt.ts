import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';
import {
  saveConversation,
  appendSessionChannelMessage,
  getRegisteredConnection,
} from './database';

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
// (connectionId, promptId) pair and is resolved exactly once — either by the
// user's reply, by a force-terminate, by a connection cancel, or by the
// per-prompt timeout.
//
// When the MCP transport's AbortSignal fires (TCP drop / agent-side timeout),
// we do NOT resolve the durable promise. Instead the tool handler simply
// awaits the same durable promise on the next retry, so the user's eventual
// reply is forwarded to the agent regardless of how many times the HTTP
// connection dropped while the user was thinking.
// ─────────────────────────────────────────────────────────────────────────────

type DurablePromptState = {
  promptId: string;
  data: PromptData;
  /** Resolves when the user replies, timeout fires, or the prompt is cancelled. */
  promise: Promise<PromptResponse>;
  resolve: (r: PromptResponse) => void;
  /** True once resolve() has been called. */
  settled: boolean;
  /** setTimeout handle for the per-prompt expiry timer. null = no timeout. */
  timer: ReturnType<typeof setTimeout> | null;
  /** setInterval handle for diagnostic logging. */
  diagInterval: ReturnType<typeof setInterval> | null;
  /** The IPC handler registered on ipcMain. */
  ipcHandler: (
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
  ) => void;
  /** Sends prompt-clear to the renderer. Captured at creation time. */
  sendPromptClear: () => void;
};

/** One active durable prompt per connection (FIFO queue handles overflow). */
const activePrompts = new Map<string, DurablePromptState>();

/** FIFO queue per connection for prompts that arrive while one is active. */
const queuedPrompts = new Map<
  string,
  { run: () => Promise<void>; resolve: (r: PromptResponse) => void }[]
>();
const queueRunning = new Set<string>();

// Beep throttle
let lastBeepTime = 0;
const BEEP_COOLDOWN_MS = 2000;

/** Max safe setTimeout value — prevents Node integer overflow (~24.8 days). */
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

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

/**
 * Cancel and clean up any active prompt for a connection.
 * Call when a connection drops to avoid leaked listeners.
 */
export function cancelActivePrompt(connectionId: string): void {
  const state = activePrompts.get(connectionId);
  if (state) {
    state.sendPromptClear();
    _settlePrompt(state, {
      answer: 'Error: Prompt superseded by a newer prompt.',
    });
  }

  const queued = queuedPrompts.get(connectionId);
  if (!queued?.length) return;

  queuedPrompts.delete(connectionId);
  for (const entry of queued) {
    entry.resolve({
      answer:
        'Error: Prompt cancelled before display because the connection was closed.',
    });
  }
}

/**
 * Force-terminate a chat for a connection. Resolves any pending prompt
 * with a termination message so the agent knows the user closed the chat.
 */
export function forceTerminateChat(connectionId: string): void {
  const state = activePrompts.get(connectionId);
  if (state) {
    _settlePrompt(state, {
      answer:
        'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.',
    });
  }

  const queued = queuedPrompts.get(connectionId);
  if (!queued?.length) return;

  queuedPrompts.delete(connectionId);
  for (const entry of queued) {
    entry.resolve({
      answer:
        'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.',
    });
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
 * for this connectionId, we return the same underlying Promise directly so the
 * retry sees the user's reply as soon as it arrives.
 *
 * This breaks the coupling between "HTTP connection alive" and "prompt active"
 * that caused the -32000 Connection closed errors.
 */
export function promptUser(
  win: BrowserWindow | null,
  data: PromptData,
  signal?: AbortSignal,
): Promise<PromptResponse> {
  return new Promise<PromptResponse>((resolveOuter) => {
    _enqueuePrompt(data.connectionId, {
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

        // ── Check if a durable prompt is already active for this connection ─
        // When the MCP transport drops and the agent retries, a new call to
        // promptUser() arrives. If there is already a live durable state we
        // attach to it rather than creating a new UI prompt.
        const existing = activePrompts.get(data.connectionId);
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

        const rc = getRegisteredConnection(data.connectionId);
        const promptWithExpiry: PromptData = {
          ...data,
          expiresAt: timeoutMs > 0 ? now + timeoutMs : 0,
          openCodeSessionId:
            rc?.openCodeSessionId ?? data.openCodeSessionId ?? null,
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

        const ipcHandler = (
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
        ): void => {
          if (response.id !== data.id) return;
          const state = activePrompts.get(data.connectionId);
          if (!state || state.settled) return;
          _settlePrompt(state, {
            answer: response.answer,
            attachments: response.attachments,
          });
          sendPromptClear();
          saveConversation({
            promptMessage: data.message,
            projectName: data.projectName,
            userResponse: response.answer,
            predefinedOptions: data.predefinedOptions,
            attachments: response.attachments,
          });
          appendSessionChannelMessage({
            sessionId: data.connectionId,
            messageType: 'answer',
            messageText: response.answer,
            attachments: response.attachments,
          });
        };

        const durableState: DurablePromptState = {
          promptId: data.id,
          data: promptWithExpiry,
          promise: durablePromise,
          resolve: durableResolve,
          settled: false,
          timer: null,
          diagInterval: null,
          ipcHandler,
          sendPromptClear,
        };

        activePrompts.set(data.connectionId, durableState);
        ipcMain.on('prompt-response', ipcHandler);

        // Forward durable promise to the outer resolver of THIS call
        void durablePromise.then(resolveOuter);

        // ── Send prompt to renderer ───────────────────────────────────────────
        win.webContents.send('prompt-request', promptWithExpiry);
        appendSessionChannelMessage({
          sessionId: data.connectionId,
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
          console.log(
            `[prompt-diag] id=${data.id} connectionId=${data.connectionId} ` +
              `settled=${durableState.settled} elapsed=${elapsed}s ` +
              `prompt-response-listeners=${listenerCount} ` +
              `activePrompts=${activePrompts.size}`,
          );
        }, 10_000);

        // ── Per-prompt expiry timer ───────────────────────────────────────────
        // The timer is intentionally NOT cancelled when the AbortSignal fires.
        // The prompt stays alive across transport reconnects; only the
        // user-configured timeout or an explicit cancel/terminate ends it.
        if (safeTimeoutMs > 0) {
          durableState.timer = setTimeout(() => {
            const state = activePrompts.get(data.connectionId);
            if (!state || state.settled) return;
            _settlePrompt(state, { answer: null as unknown as string });
            appendSessionChannelMessage({
              sessionId: data.connectionId,
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

  ipcMain.removeListener('prompt-response', state.ipcHandler);

  const current = activePrompts.get(state.data.connectionId);
  if (current && current.promptId === state.promptId) {
    activePrompts.delete(state.data.connectionId);
  }

  state.resolve(response);
}

function _enqueuePrompt(
  connectionId: string,
  entry: { run: () => Promise<void>; resolve: (r: PromptResponse) => void },
): void {
  const queue = queuedPrompts.get(connectionId);
  if (queue) {
    queue.push(entry);
  } else {
    queuedPrompts.set(connectionId, [entry]);
  }
  void _processQueue(connectionId);
}

async function _processQueue(connectionId: string): Promise<void> {
  if (queueRunning.has(connectionId)) return;
  queueRunning.add(connectionId);

  try {
    while (true) {
      const queue = queuedPrompts.get(connectionId);
      if (!queue?.length) {
        queuedPrompts.delete(connectionId);
        return;
      }
      const next = queue.shift();
      if (!next) return;
      await next.run();
    }
  } finally {
    queueRunning.delete(connectionId);
  }
}
