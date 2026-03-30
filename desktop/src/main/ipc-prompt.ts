import type { BrowserWindow } from 'electron';
import { ipcMain, shell } from 'electron';
import { saveConversation } from './database';

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
}

// Per-connection tracking to prevent duplicate/overlapping prompts
const activePrompts = new Map<
  string,
  { promptId: string; cancel: () => void }
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

export function promptUser(
  win: BrowserWindow | null,
  data: PromptData,
): Promise<string> {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve('Error: Application window is not available.');
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
      response: { id: string; answer: string },
    ): void => {
      if (response.id === data.id) {
        cleanup();
        saveConversation({
          promptMessage: data.message,
          projectName: data.projectName,
          userResponse: response.answer,
          predefinedOptions: data.predefinedOptions,
        });
        resolve(response.answer);
      }
    };
    ipcMain.on('prompt-response', handler);

    // Register as the active prompt for this connection
    activePrompts.set(data.connectionId, {
      promptId: data.id,
      cancel: () => {
        cleanup();
        resolve('Error: Prompt superseded by a newer prompt.');
      },
    });

    const timeoutMs = _getPromptTimeoutMs();
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve('Error: Prompt timed out — no response received.');
      }, timeoutMs);
    }
  });
}
