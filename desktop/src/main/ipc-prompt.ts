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

type PromptControl = {
  promptId: string;
  data: PromptData;
  cancel: () => void;
  terminate: () => void;
};

type PromptQueueEntry = {
  run: () => Promise<void>;
  resolve: (value: PromptResponse) => void;
};

// One active prompt + FIFO queue per connection keeps delivery deterministic
// even when multiple agents happen to share the same MCP connection.
const activePrompts = new Map<string, PromptControl>();
const queuedPrompts = new Map<string, PromptQueueEntry[]>();
const queueRunning = new Set<string>();

// Beep throttle to prevent rapid-fire notification sounds
let lastBeepTime = 0;
const BEEP_COOLDOWN_MS = 2000;

/**
 * Return the PromptData for every currently-active prompt (one per connection).
 * Used by the renderer on startup to recover prompts that arrived while the
 * renderer was restarting (main-process memory survives renderer restarts).
 */
export function getActivePromptData(): PromptData[] {
  const result: PromptData[] = [];
  for (const control of activePrompts.values()) {
    result.push(control.data);
  }
  return result;
}

/**
 * Cancel and clean up any active prompt for a connection.
 * Call when a connection drops to avoid leaked listeners.
 */
export function cancelActivePrompt(connectionId: string): void {
  const existing = activePrompts.get(connectionId);
  if (existing) {
    existing.cancel();
  }

  const queued = queuedPrompts.get(connectionId);
  if (!queued?.length) {
    return;
  }

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
  const existing = activePrompts.get(connectionId);
  if (existing) {
    existing.terminate();
  }

  const queued = queuedPrompts.get(connectionId);
  if (!queued?.length) {
    return;
  }

  queuedPrompts.delete(connectionId);
  for (const entry of queued) {
    entry.resolve({
      answer:
        'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.',
    });
  }
}

async function processQueue(connectionId: string): Promise<void> {
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
      if (!next) {
        return;
      }

      await next.run();
    }
  } finally {
    queueRunning.delete(connectionId);
  }
}

function enqueuePrompt(connectionId: string, entry: PromptQueueEntry): void {
  const queue = queuedPrompts.get(connectionId);
  if (queue) {
    queue.push(entry);
  } else {
    queuedPrompts.set(connectionId, [entry]);
  }

  void processQueue(connectionId);
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

export function promptUser(
  win: BrowserWindow | null,
  data: PromptData,
  signal?: AbortSignal,
): Promise<PromptResponse> {
  return new Promise((resolve) => {
    enqueuePrompt(data.connectionId, {
      resolve,
      run: async () => {
        // If the signal is already aborted, resolve immediately.
        if (signal?.aborted) {
          resolve({
            answer:
              'Error: Tool call aborted — the MCP session was closed or the request was cancelled.',
          });
          return;
        }

        if (!win || win.isDestroyed()) {
          resolve({ answer: 'Error: Application window is not available.' });
          return;
        }

        win.show();
        win.focus();

        // Throttle beeps so rapid duplicate calls don't cause a sound loop
        const now = Date.now();
        if (_getSoundEnabled() && now - lastBeepTime >= BEEP_COOLDOWN_MS) {
          lastBeepTime = now;
          shell.beep();
        }

        const timeoutMs = _getPromptTimeoutMs();
        const rc = getRegisteredConnection(data.connectionId);
        const promptWithExpiry: PromptData = {
          ...data,
          expiresAt: timeoutMs > 0 ? now + timeoutMs : 0,
          openCodeSessionId:
            rc?.openCodeSessionId ?? data.openCodeSessionId ?? null,
        };
        win.webContents.send('prompt-request', promptWithExpiry);
        appendSessionChannelMessage({
          sessionId: data.connectionId,
          messageType: 'question',
          messageText: data.message,
        });

        let settled = false;
        let diagInterval: ReturnType<typeof setInterval> | null = null;

        const sendPromptClear = (): void => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('prompt-clear', {
              id: data.id,
              connectionId: data.connectionId,
              openCodeSessionId: promptWithExpiry.openCodeSessionId ?? null,
            });
          }
        };

        const cleanup = (): void => {
          if (settled) return;
          settled = true;
          if (diagInterval) {
            clearInterval(diagInterval);
            diagInterval = null;
          }
          ipcMain.removeListener('prompt-response', handler);
          // Only remove from map if we're still the active prompt
          const current = activePrompts.get(data.connectionId);
          if (current && current.promptId === data.id) {
            activePrompts.delete(data.connectionId);
          }
        };

        const handler = (
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
          if (response.id === data.id) {
            cleanup();
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
            resolve({
              answer: response.answer,
              attachments: response.attachments,
            });
          }
        };
        ipcMain.on('prompt-response', handler);

        // Listen for abort signal from the MCP SDK (fires when server.close() or
        // notifications/cancelled is received). This prevents the prompt from
        // hanging indefinitely when the desktop app restarts.
        if (signal) {
          const onAbort = (): void => {
            if (settled) return;
            cleanup();
            sendPromptClear();
            resolve({
              answer:
                'Error: Tool call aborted — the MCP session was closed or the request was cancelled.',
            });
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }

        // Register as the active prompt for this connection while displayed.
        activePrompts.set(data.connectionId, {
          promptId: data.id,
          data: promptWithExpiry,
          cancel: () => {
            cleanup();
            sendPromptClear();
            resolve({ answer: 'Error: Prompt superseded by a newer prompt.' });
          },
          terminate: () => {
            cleanup();
            sendPromptClear();
            resolve({
              answer:
                'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.',
            });
          },
        });

        // ─── Diagnostic polling ───
        // Logs prompt state every 10 s so we can trace why a response
        // sometimes never arrives at the resolve() call.
        const diagStart = Date.now();
        diagInterval = setInterval(() => {
          const elapsed = Math.round((Date.now() - diagStart) / 1000);
          const listenerCount = ipcMain.listenerCount('prompt-response');
          console.log(
            `[prompt-diag] id=${data.id} connectionId=${data.connectionId} ` +
              `settled=${settled} elapsed=${elapsed}s ` +
              `prompt-response-listeners=${listenerCount} ` +
              `activePrompts=${activePrompts.size}`,
          );
          if (settled) clearInterval(diagInterval!);
        }, 10_000);

        if (timeoutMs > 0) {
          setTimeout(() => {
            if (settled) return;

            // Resolve null to the agent and clear the prompt immediately so the UI
            // never presents an expired prompt as still replyable.
            resolve({ answer: null as unknown as string });

            // Also remove the active-prompt entry so cancel/terminate don't
            // try to call the already-resolved promise again.
            const current = activePrompts.get(data.connectionId);
            if (current && current.promptId === data.id) {
              activePrompts.delete(data.connectionId);
            }

            // Remove the original handler now (it had already been removed by
            // cleanup above for normal resolve paths; this is the timeout path
            // where cleanup was NOT called yet).
            settled = true;
            if (diagInterval) {
              clearInterval(diagInterval);
              diagInterval = null;
            }
            ipcMain.removeListener('prompt-response', handler);
            appendSessionChannelMessage({
              sessionId: data.connectionId,
              messageType: 'agent_message',
              messageText:
                'Prompt expired before a reply was submitted. Ask again to continue this interaction.',
            });
            sendPromptClear();
          }, timeoutMs);
        }
      },
    });
  });
}
