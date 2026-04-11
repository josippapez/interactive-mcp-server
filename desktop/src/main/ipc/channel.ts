/**
 * Centralized IPC channel communication for renderer.
 *
 * This module provides a single abstraction for all main process → renderer
 * communication that involves session routing. It ensures:
 *
 * 1. Consistent openCodeSessionId resolution (explicit param > DB lookup)
 * 2. Type-safe IPC message payloads
 * 3. Single point of maintenance for routing logic
 *
 * All tools that need to send messages to the renderer should use these
 * functions instead of calling `webContents.send()` directly.
 */

import type { BrowserWindow } from 'electron';
import { resolveOpenCodeSessionId } from '../session/resolver';

// ─── Base payload type ─────────────────────────────────────────────────────

/**
 * Base payload included in all session-routed IPC messages.
 * The renderer uses these fields to route messages to the correct channel.
 */
export interface SessionRoutedPayload {
  connectionId: string;
  openCodeSessionId: string | null;
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
 * This is the core function that all session-routed IPC communication
 * should go through. It resolves the openCodeSessionId using the centralized
 * resolver, ensuring consistent priority ordering.
 *
 * @param win - The BrowserWindow to send to (null-safe)
 * @param channel - The IPC channel name
 * @param connectionId - The MCP transport UUID
 * @param explicitSessionId - Optional explicit openCodeSessionId from the agent
 * @param payload - Additional payload data specific to this channel
 */
export function sendToRenderer<T extends Record<string, unknown>>(
  win: BrowserWindow | null,
  channel: string,
  connectionId: string,
  explicitSessionId: string | null | undefined,
  payload: T,
): void {
  if (!win || win.isDestroyed()) return;

  const resolvedSessionId = resolveOpenCodeSessionId(
    connectionId,
    explicitSessionId,
  );

  win.webContents.send(channel, {
    connectionId,
    openCodeSessionId: resolvedSessionId,
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
  connectionId: string,
  explicitSessionId: string | null | undefined,
  status: string,
  type: 'info' | 'working' | 'success' | 'error',
): void {
  sendToRenderer(
    win,
    'session-status-update',
    connectionId,
    explicitSessionId,
    {
      status,
      type,
    },
  );
}

/**
 * Send a persistent agent message to the renderer.
 * Used by `send_message` tool.
 */
export function sendAgentMessage(
  win: BrowserWindow | null,
  connectionId: string,
  explicitSessionId: string | null | undefined,
  message: string,
): void {
  sendToRenderer(win, 'agent-message', connectionId, explicitSessionId, {
    message,
  });
}

/**
 * Send an intensive chat start event to the renderer.
 * Used by `start_intensive_chat` tool.
 */
export function sendIntensiveChatStart(
  win: BrowserWindow | null,
  connectionId: string,
  explicitSessionId: string | null | undefined,
  sessionId: string,
  title: string,
): void {
  sendToRenderer(win, 'intensive-chat-start', connectionId, explicitSessionId, {
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
  connectionId: string,
  explicitSessionId: string | null | undefined,
  sessionId: string,
): void {
  sendToRenderer(win, 'intensive-chat-stop', connectionId, explicitSessionId, {
    sessionId,
  });
}

/**
 * Send a prompt clear event to the renderer.
 * Used by prompt timeout/cancellation.
 */
export function sendPromptClear(
  win: BrowserWindow | null,
  connectionId: string,
  explicitSessionId: string | null | undefined,
  promptId: string,
): void {
  sendToRenderer(win, 'prompt-clear', connectionId, explicitSessionId, {
    id: promptId,
  });
}
