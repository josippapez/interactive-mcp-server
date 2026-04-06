import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';
import { saveConversation, appendSessionChannelMessage } from './database';

let _getSoundEnabled: () => boolean = () => true;
let _getPromptTimeoutMs: () => number = () => 800_000;

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
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
}

// Per-connection tracking to prevent duplicate/overlapping prompts
const activePrompts = new Map<
  string,
  { promptId: string; cancel: () => void; terminate: () => void }
>();

// Beep throttle to prevent rapid-fire notification sounds
let lastBeepTime = 0;
const BEEP_COOLDOWN_MS = 2000;

/**
 * Cancel and clean up any active prompt for a connection.
 * Call when a connection drops to avoid leaked listeners.
 */
export function cancelActivePrompt(connectionId: string): void {
  const existing = activePrompts.get(connectionId);
  if (existing) {
    existing.cancel();
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
}

export interface PromptResponse {
  answer: string;
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

    // Supersede any existing prompt for this connection so listeners don't pile up
    const existing = activePrompts.get(data.connectionId);
    if (existing) {
      existing.cancel();
    }

    win.show();
    win.focus();

    // Throttle beeps so rapid duplicate calls don't cause a sound loop
    const now = Date.now();
    if (_getSoundEnabled() && now - lastBeepTime >= BEEP_COOLDOWN_MS) {
      lastBeepTime = now;
      shell.beep();
    }

    win.webContents.send('prompt-request', data);
    appendSessionChannelMessage({
      sessionId: data.connectionId,
      messageType: 'question',
      messageText: data.message,
    });

    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
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
        resolve({ answer: response.answer, attachments: response.attachments });
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
        resolve({
          answer:
            'Error: Tool call aborted — the MCP session was closed or the request was cancelled.',
        });
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Register as the active prompt for this connection
    activePrompts.set(data.connectionId, {
      promptId: data.id,
      cancel: () => {
        cleanup();
        resolve({ answer: 'Error: Prompt superseded by a newer prompt.' });
      },
      terminate: () => {
        cleanup();
        resolve({
          answer:
            'USER_FORCE_TERMINATED: The user has force-terminated this conversation. Stop all current work and acknowledge the termination.',
        });
      },
    });

    const timeoutMs = _getPromptTimeoutMs();
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve({ answer: 'Error: Prompt timed out — no response received.' });
      }, timeoutMs);
    }
  });
}
