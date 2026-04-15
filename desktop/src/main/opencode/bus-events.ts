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
import type { AppSettings } from '../settings';
import { createLogger } from '../utils/logger';
import {
  buildOpenCodePortCandidates,
  resolveReachableOpenCodePorts,
} from './endpoints';
import { handleBusEvent } from './bus-event-handler';

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

// ─── SSE subscription ─────────────────────────────────────────────────────────

async function subscribeToBusEvents(openCodePort: number): Promise<void> {
  const reachable = await resolveReachableOpenCodePorts(openCodePort);
  const ports =
    reachable.length > 0
      ? reachable
      : buildOpenCodePortCandidates(openCodePort);

  const controllers: AbortController[] = [];
  _sseAbortController = {
    abort: () => {
      for (const controller of controllers) {
        controller.abort();
      }
    },
  } as AbortController;

  await Promise.all(
    ports.map(async (port) => {
      const url = `http://localhost:${port}/global/event`;
      const controller = new AbortController();
      controllers.push(controller);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
        });

        if (!res.ok || !res.body) {
          sseLog.warn(
            `SSE connect failed on port ${port}: ${res.status} — will retry in ${SSE_RECONNECT_DELAY_MS}ms`,
          );
          return;
        }

        sseLog.info(`SSE connected to ${url}`);

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
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data:'));
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
        sseLog.error(
          `SSE error on port ${port}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

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
