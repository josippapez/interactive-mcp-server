/**
 * OpenCode global-event bus subscriber.
 *
 * Subscribes to the OpenCode `/global/event` SSE stream and forwards relevant
 * events to the renderer via IPC:
 *
 *   permission.asked     → 'permission-asked'  (look up connectionId from sessionID)
 *   permission.replied   → 'permission-replied'
 *   session.status       → 'opencode-session-status' (real-time session status)
 *   session.idle         → 'opencode-session-idle' (turn finished, no UI consumer yet)
 *   session.error        → 'opencode-session-error' (ProviderAuth/ContextOverflow/etc.)
 *   file.edited          → 'opencode-file-edited' (file changed on disk in directory)
 *   todo.updated         → 'opencode-todo-updated' (real-time todo changes)
 *   vcs.branch.updated   → 'opencode-vcs-updated' (real-time VCS branch changes)
 *
 * Uses the OpenCode SDK for SSE streaming.
 */

import type { BrowserWindow } from 'electron';
import type { GlobalEvent } from '@opencode-ai/sdk/v2';
import type { AppSettings } from '../settings';
import { createLogger } from '../utils/logger';
import { getClient } from './sdk-client';
import { handleBusEvent } from './bus-event-handler';
import { errorMessage } from '../utils/errors';

const sseLog = createLogger('sse');

/** Reconnect delay when the SSE stream drops (ms). */
const SSE_RECONNECT_DELAY_MS = 2_000;

// ─── Module-level state ───────────────────────────────────────────────────────

let _sseAbortController: AbortController | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _getWindow: (() => BrowserWindow | null) | null = null;
let _getOpenCodePort: (() => number) | null = null;
let _getSettings: (() => AppSettings) | null = null;

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
  handleBusEvent(envelope, win as BrowserWindow | null, {
    getOpenCodePort: _getOpenCodePort,
    getSettings: _getSettings,
  });
}

// ─── SSE subscription using SDK ───────────────────────────────────────────────

async function subscribeToPortWithSdk(
  port: number,
  controller: AbortController,
): Promise<void> {
  const client = getClient(port);

  try {
    sseLog.info(`SSE connecting to port ${port} via SDK`);

    const result = await client.global.event({
      signal: controller.signal,
    });

    sseLog.info(`SSE connected to port ${port}`);

    // Iterate over the SSE stream
    for await (const event of result.stream) {
      if (controller.signal.aborted) break;

      const envelope = event as GlobalEvent;
      const win = _getWindow?.() ?? null;
      _handleBusEventForTest(
        {
          directory: envelope.directory,
          payload: envelope.payload,
        },
        win,
      );
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') return;
    sseLog.error(`SSE error on port ${port}: ${errorMessage(err)}`);
  }
}

async function subscribeToBusEvents(openCodePort: number): Promise<void> {
  const controller = new AbortController();
  _sseAbortController = controller;

  await subscribeToPortWithSdk(openCodePort, controller);

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
  getSettings?: () => AppSettings,
): void {
  if (_sseAbortController !== null) return;

  _getWindow = getWindow;
  _getOpenCodePort = getOpenCodePort;
  _getSettings = getSettings ?? null;

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
