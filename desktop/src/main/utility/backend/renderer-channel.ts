/**
 * Utility-side session-routed renderer events.
 *
 * Replaces the main-resident `src/main/ipc/channel.ts` for utility-local
 * callers (MCP tools). Same payload shape — the renderer consumes identical
 * IPC channel names — but the transport is the bridge `to-renderer` envelope
 * instead of a direct `BrowserWindow.webContents.send`.
 */

import { emitToRenderer } from './renderer-emit';

export interface SessionRoutedPayload {
  providerSessionId: string | null;
}

function send<T extends Record<string, unknown>>(
  channel: string,
  providerSessionId: string | null,
  payload: T,
): void {
  emitToRenderer(channel, { providerSessionId, ...payload });
}

export function sendSessionStatus(
  providerSessionId: string | null,
  status: string,
  type: 'info' | 'working' | 'success' | 'error',
): void {
  send('session-status-update', providerSessionId, { status, type });
}

export function sendAgentMessage(
  providerSessionId: string | null,
  message: string,
): void {
  send('agent-message', providerSessionId, { message });
}

export function sendIntensiveChatStart(
  providerSessionId: string | null,
  sessionId: string,
  title: string,
): void {
  send('intensive-chat-start', providerSessionId, { sessionId, title });
}

export function sendIntensiveChatStop(
  providerSessionId: string | null,
  sessionId: string,
): void {
  send('intensive-chat-stop', providerSessionId, { sessionId });
}

export function sendPromptClear(
  providerSessionId: string | null,
  promptId: string,
): void {
  send('prompt-clear', providerSessionId, { id: promptId });
}
