/**
 * Utility-side proxy to the main-resident prompt store (`src/main/ipc/prompt.ts`).
 *
 * The prompt store lives in the main process because it depends on
 * `BrowserWindow.webContents.send` / `shell.beep` / `ipcMain.on('prompt-response')`
 * — all Electron-main-only APIs. From the utility process we reach it over the
 * bridge via RPCs registered in `utility/supervisor.ts`.
 *
 * Types mirror the main-side module so tool call-sites can share the same
 * `PromptData` / `PromptResponse` shapes.
 */

import { getMainRpc } from './rpc';
import { getSettingsSnapshot } from './settings-mirror';

export interface PromptData {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  expiresAt: number;
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
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

/**
 * Signature kept for callers that pass a PromptUserFn around. The first
 * argument (historically the `BrowserWindow`) is accepted and ignored — the
 * main-side RPC handler always targets the current main window.
 *
 * AbortSignal is accepted and forwarded as a best-effort cancel over the
 * bridge; the main-side handler will emit a `cancelActivePrompt` for the
 * connectionId when the signal fires.
 */
export type PromptUserFn = (
  win: unknown,
  data: PromptData,
  signal?: AbortSignal,
) => Promise<PromptResponse>;

/** Request that main display a prompt and return the user's reply. */
export const promptUser: PromptUserFn = async (_win, data, signal) => {
  const bridge = getMainRpc();

  // Best-effort abort wiring: when the agent-side AbortSignal fires (e.g.
  // transport drop mid-prompt), tell main to cancel any active prompt on
  // this transport. Main's durable-prompt map survives the cancel for
  // reconnect purposes when keyed on providerSessionId (see ipc/prompt.ts).
  if (signal) {
    const onAbort = (): void => {
      try {
        bridge.emit('main.cancelActivePrompt', {
          identity: data.providerSessionId ?? data.connectionId,
        });
      } catch {
        /* ignore */
      }
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const result = await bridge.request<PromptResponse>(
    'main.promptUser',
    { data },
    // No client-side timeout — main enforces per-prompt expiry via PromptData.
    { timeoutMs: 0 },
  );
  return result;
};

export function getPromptTimeoutSeconds(): number {
  return getSettingsSnapshot().promptTimeoutSeconds;
}

export function cancelActivePrompt(identity: string): void {
  const bridge = getMainRpc();
  try {
    bridge.emit('main.cancelActivePrompt', { identity });
  } catch {
    /* ignore */
  }
}

export function forceTerminateChat(identity: string): void {
  const bridge = getMainRpc();
  try {
    bridge.emit('main.forceTerminateChat', { identity });
  } catch {
    /* ignore */
  }
}
