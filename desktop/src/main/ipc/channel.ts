/**
 * Centralized IPC channel communication for renderer.
 *
 * This module provides a single abstraction for all main process → renderer
 * communication that involves session routing. It ensures:
 *
 * 1. Type-safe IPC message payloads
 * 2. Single point of maintenance for routing logic
 *
 * Callers MUST resolve `providerSessionId` at the tool boundary using
 * `resolveProviderSessionId` and pass it explicitly. `sendToRenderer` does
 * NOT perform any resolution itself.
 *
 * All tools that need to send messages to the renderer should use these
 * functions instead of calling `webContents.send()` directly.
 */

import type { BrowserWindow } from 'electron';

// ─── Base payload type ─────────────────────────────────────────────────────

/**
 * Base payload included in all session-routed IPC messages.
 * The renderer uses this field to route messages to the correct channel.
 */
export interface SessionRoutedPayload {
  providerSessionId: string | null;
}

// ─── IPC Channel Types ─────────────────────────────────────────────────────

export interface SessionStatusPayload extends SessionRoutedPayload {
  status: string;
  type: 'info' | 'working' | 'success' | 'error';
}

export interface AgentMessagePayload extends SessionRoutedPayload {
  message: string;
}

export interface IntensiveChatStartPayload extends SessionRoutedPayload {
  sessionId: string;
  title: string;
}

export interface IntensiveChatStopPayload extends SessionRoutedPayload {
  sessionId: string;
}

export interface PromptClearPayload extends SessionRoutedPayload {
  id: string;
}

// ─── Core send function ────────────────────────────────────────────────────

/**
 * Send an IPC message to the renderer with proper session routing.
 *
 * Callers MUST resolve `providerSessionId` at the tool boundary before calling
 * this function — no resolution is performed here.
 *
 * @param win - The BrowserWindow to send to (null-safe)
 * @param channel - The IPC channel name
 * @param providerSessionId - The resolved provider session ID (nullable)
 * @param payload - Additional payload data specific to this channel
 */
export function sendToRenderer<T extends Record<string, unknown>>(
  win: BrowserWindow | null,
  channel: string,
  providerSessionId: string | null,
  payload: T,
): void {
  if (!win || win.isDestroyed()) return;

  win.webContents.send(channel, {
    providerSessionId,
    ...payload,
  });
}

// ─── Typed channel helpers ─────────────────────────────────────────────────

/**
 * Send a session status update to the renderer.
 * Used by `push_session_status` tool and internal status updates.
 */
export function sendSessionStatus(
  win: BrowserWindow | null,
  providerSessionId: string | null,
  status: string,
  type: 'info' | 'working' | 'success' | 'error',
): void {
  sendToRenderer(win, 'session-status-update', providerSessionId, {
    status,
    type,
  });
}

/**
 * Send a persistent agent message to the renderer.
 * Used by `send_message` tool.
 */
export function sendAgentMessage(
  win: BrowserWindow | null,
  providerSessionId: string | null,
  message: string,
): void {
  sendToRenderer(win, 'agent-message', providerSessionId, {
    message,
  });
}

/**
 * Send an intensive chat start event to the renderer.
 * Used by `start_intensive_chat` tool.
 */
export function sendIntensiveChatStart(
  win: BrowserWindow | null,
  providerSessionId: string | null,
  sessionId: string,
  title: string,
): void {
  sendToRenderer(win, 'intensive-chat-start', providerSessionId, {
    sessionId,
    title,
  });
}

/**
 * Send an intensive chat stop event to the renderer.
 * Used by `stop_intensive_chat` tool.
 */
export function sendIntensiveChatStop(
  win: BrowserWindow | null,
  providerSessionId: string | null,
  sessionId: string,
): void {
  sendToRenderer(win, 'intensive-chat-stop', providerSessionId, {
    sessionId,
  });
}

/**
 * Send a prompt clear event to the renderer.
 * Used by prompt timeout/cancellation.
 */
export function sendPromptClear(
  win: BrowserWindow | null,
  providerSessionId: string | null,
  promptId: string,
): void {
  sendToRenderer(win, 'prompt-clear', providerSessionId, {
    id: promptId,
  });
}
