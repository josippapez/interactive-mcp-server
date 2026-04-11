/**
 * OpenCode global-event bus subscriber.
 *
 * Subscribes to the OpenCode `/global/event` SSE stream and forwards relevant
 * events to the renderer via IPC:
 *
 *   permission.asked     → 'permission-asked'  (look up connectionId from sessionID)
 *   permission.replied   → 'permission-replied'
 *   session.status       → 'opencode-session-status' (real-time session status)
 *   todo.updated         → 'opencode-todo-updated' (real-time todo changes)
 *   vcs.branch.updated   → 'opencode-vcs-updated' (real-time VCS branch changes)
 *
 * The subscription is shared — this module manages its own AbortController so
 * it can be stopped independently of the session-tree-manager.
 */

import type { BrowserWindow } from 'electron';
import { getAllRegisteredConnections } from '../database';

/** Reconnect delay when the SSE stream drops (ms). */
const SSE_RECONNECT_DELAY_MS = 2_000;

// ─── Event envelope types ────────────────────────────────────────────────────

interface BusEventEnvelope {
  payload: {
    type: string;
    properties: Record<string, unknown>;
  };
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _sseAbortController: AbortController | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _getWindow: (() => BrowserWindow | null) | null = null;
let _getOpenCodePort: (() => number) | null = null;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find the connectionId for a given OpenCode sessionID.
 * Returns null if no registered connection owns that session.
 */
function connectionIdForSession(sessionID: string): string | null {
  const connections = getAllRegisteredConnections();
  const match = connections.find((c) => c.openCodeSessionId === sessionID);
  return match?.connectionId ?? null;
}

function sendToWindow(
  win: BrowserWindow,
  channel: string,
  data: unknown,
): void {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, data);
}

// ─── Event handler (exported for unit tests) ──────────────────────────────────

/**
 * Handle a single parsed bus-event envelope.
 *
 * @param envelope - Raw parsed JSON from the SSE stream.
 * @param win      - BrowserWindow to send IPC events to (may be null).
 *
 * @internal Exported as `_handleBusEventForTest` for unit testing only.
 */
export function _handleBusEventForTest(envelope: unknown, win: unknown): void {
  if (!envelope || typeof envelope !== 'object') return;

  const env = envelope as Partial<BusEventEnvelope>;
  const payload = env.payload;
  if (!payload?.type || !payload.properties) return;

  const { type, properties } = payload;
  const browserWin = win as BrowserWindow | null;

  if (!browserWin) return;

  if (type === 'permission.asked') {
    const sessionID = properties['sessionID'] as string | undefined;
    if (!sessionID) return;

    const connectionId = connectionIdForSession(sessionID);
    if (!connectionId) return;

    sendToWindow(browserWin, 'permission-asked', {
      connectionId,
      requestId: properties['id'] as string,
      sessionID,
      permission: properties['permission'] as string,
      patterns: properties['patterns'] as string[] | undefined,
      always: properties['always'] as boolean | undefined,
      tool: properties['tool'] as
        | { messageID: string; callID: string }
        | undefined,
      metadata: properties['metadata'] as Record<string, unknown> | undefined,
    });
    return;
  }

  if (type === 'permission.replied') {
    sendToWindow(browserWin, 'permission-replied', {
      sessionID: properties['sessionID'] as string,
      requestID: properties['requestID'] as string,
      reply: properties['reply'] as 'once' | 'always' | 'reject',
    });
    return;
  }

  if (type === 'session.status') {
    sendToWindow(browserWin, 'session-status-update', {
      connectionId: properties['connectionId'] as string,
      status: properties['status'] as string,
      type: properties['type'] as string,
    });

    // Also send the new structured session status event
    const sessionID = properties['sessionID'] as string | undefined;
    const status = properties['status'] as
      | { type: 'idle' | 'busy' | 'retry' }
      | undefined;
    if (sessionID && status) {
      sendToWindow(browserWin, 'opencode-session-status', {
        sessionID,
        status: status.type ?? 'unknown',
      });
    }
    return;
  }

  // Real-time todo updates
  if (type === 'todo.updated') {
    const sessionID = properties['sessionID'] as string | undefined;
    const todos = properties['todos'] as
      | Array<{
          id: string;
          content: string;
          status: string;
          priority: string;
        }>
      | undefined;
    if (sessionID && todos) {
      sendToWindow(browserWin, 'opencode-todo-updated', {
        sessionID,
        todos,
      });
    }
    return;
  }

  // Real-time VCS branch updates
  if (type === 'vcs.branch.updated') {
    const branch = properties['branch'] as string | undefined;
    sendToWindow(browserWin, 'opencode-vcs-updated', {
      branch: branch ?? null,
    });
    return;
  }

  // Real-time message events (conversation mirroring)
  if (
    type === 'message.created' ||
    type === 'message.updated' ||
    type === 'message.completed'
  ) {
    const sessionID = properties['sessionID'] as string | undefined;
    const messageID = properties['messageID'] as string | undefined;
    if (sessionID) {
      sendToWindow(browserWin, 'conversation-message-event', {
        type,
        sessionId: sessionID,
        messageId: messageID,
      });
    }
    return;
  }

  // NOTE: message.part.updated events are SyncEvents, not BusEvents.
  // They are handled by tree-manager.ts which subscribes to /global/sync-event.
  // The old "part.added" / "part.updated" handlers were removed as those
  // event type names don't exist in OpenCode.

  // Real-time streaming delta events (character-by-character text streaming)
  if (type === 'message.part.delta') {
    const sessionID = properties['sessionID'] as string | undefined;
    const messageID = properties['messageID'] as string | undefined;
    const partID = properties['partID'] as string | undefined;
    const field = properties['field'] as string | undefined;
    const delta = properties['delta'] as string | undefined;

    if (sessionID && messageID && partID && field && delta !== undefined) {
      sendToWindow(browserWin, 'conversation-part-delta', {
        type: 'part.delta' as const,
        sessionId: sessionID,
        messageId: messageID,
        partId: partID,
        deltaField: field,
        deltaValue: delta,
      });
    }
    return;
  }
}

// ─── SSE subscription ─────────────────────────────────────────────────────────

async function subscribeToBusEvents(openCodePort: number): Promise<void> {
  const url = `http://localhost:${openCodePort}/global/event`;
  const controller = new AbortController();
  _sseAbortController = controller;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    });

    if (!res.ok || !res.body) {
      console.warn(
        `[bus-events] SSE connect failed: ${res.status} — will retry in ${SSE_RECONNECT_DELAY_MS}ms`,
      );
      scheduleReconnect();
      return;
    }

    console.log(`[bus-events] SSE connected to ${url}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\n\n/);
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;

        const raw = dataLine.slice('data:'.length).trim();
        if (!raw) continue;

        try {
          const envelope = JSON.parse(raw) as unknown;
          const win = _getWindow?.() ?? null;
          _handleBusEventForTest(envelope, win);
        } catch {
          // malformed JSON — ignore
        }
      }
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') return;
    console.warn(`[bus-events] SSE error:`, err);
  }

  scheduleReconnect();
}

function scheduleReconnect(): void {
  if (_reconnectTimer !== null || _sseAbortController === null) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    const port = _getOpenCodePort?.() ?? 4096;
    void subscribeToBusEvents(port);
  }, SSE_RECONNECT_DELAY_MS);
}

// ─── Public lifecycle API ─────────────────────────────────────────────────────

/**
 * Start the global-event bus subscription.
 * Safe to call multiple times — subsequent calls are no-ops until stop is called.
 */
export function startBusEventSubscription(
  getWindow: () => BrowserWindow | null,
  getOpenCodePort: () => number,
): void {
  if (_sseAbortController !== null) return;

  _getWindow = getWindow;
  _getOpenCodePort = getOpenCodePort;

  void subscribeToBusEvents(getOpenCodePort());
}

/** Stop the bus-event SSE subscription and clean up timers. */
export function stopBusEventSubscription(): void {
  _sseAbortController?.abort();
  _sseAbortController = null;

  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }

  _getWindow = null;
  _getOpenCodePort = null;
}
