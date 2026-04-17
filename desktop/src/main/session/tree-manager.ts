/**
 * Session-tree manager.
 *
 * Subscribes to the OpenCode `/global/event` SSE stream and maintains
 * an in-memory cache of all known sessions. When the cache changes the
 * manager emits a `session-tree-updated` IPC event with a full snapshot of
 * `SessionNodeData[]` to the renderer.
 *
 * This file is a thin orchestrator. Domain logic lives in the sibling
 * `tree-manager/` directory:
 *   - types.ts              shared types & constants
 *   - state.ts              module-level mutable state (caches + lifecycle flags)
 *   - vcs.ts                VCS info extraction
 *   - part-mapping.ts       SSE part-type / tool-status enum mapping
 *   - snapshot.ts           snapshot builder + emission / debounce
 *   - auto-register.ts      auto-register + auto-bind + tombstone + pending registry
 *   - rest-seed.ts          initial REST seed + on-demand refresh
 *   - sse-subscription.ts   SSE stream + event dispatch
 */

import type { BrowserWindow } from 'electron';
import { state } from './tree-manager/state';
import { buildSnapshot } from './tree-manager/snapshot';
import { subscribeToSyncEvents } from './tree-manager/sse-subscription';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export {
  recordPendingConnection,
  tombstoneOpenCodeSession,
} from './tree-manager/auto-register';
export { refreshSessionTreeCache } from './tree-manager/rest-seed';
export type {
  OpenCodeSession,
  SessionNodeData,
  VcsInfo,
} from './tree-manager/types';

// ─── Public lifecycle API ─────────────────────────────────────────────────────

/**
 * Start the session-tree sync using SSE.
 * Safe to call multiple times — subsequent calls are no-ops until stop is called.
 */
export function startSessionTreeManager(
  getWindow: () => BrowserWindow | null,
  getOpenCodePort: () => number,
  getAutoRegisterSubagents?: () => boolean,
): void {
  if (state.sseAbortController !== null) return;

  state.getWindow = getWindow;
  state.getOpenCodePort = getOpenCodePort;
  state.getAutoRegisterSubagents = getAutoRegisterSubagents ?? null;

  void subscribeToSyncEvents(getOpenCodePort());
}

/** Stop the SSE subscription and clean up all timers. */
export function stopSessionTreeManager(): void {
  state.sseAbortController?.abort();
  state.sseAbortController = null;

  if (state.reconnectTimer !== null) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.snapshotTimer !== null) {
    clearTimeout(state.snapshotTimer);
    state.snapshotTimer = null;
  }

  state.getWindow = null;
  state.getOpenCodePort = null;
  state.getAutoRegisterSubagents = null;
  state.restSeedCompleted = false;
}

/**
 * Force an immediate re-snapshot and emit `session-tree-updated`.
 * Called after register_connection so the renderer sees the update right away.
 * Also clears the pending snapshot flag since we're emitting successfully.
 */
export async function triggerSessionTreeUpdate(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    state.snapshotPending = true;
    return;
  }
  state.snapshotPending = false; // Clear pending flag on successful emit
  const snapshot = buildSnapshot();
  win.webContents.send('session-tree-updated', snapshot);
}

export function replayPendingSessionTreeSnapshot(
  getWindow: () => BrowserWindow | null,
): void {
  if (!state.snapshotPending) {
    return;
  }

  void triggerSessionTreeUpdate(getWindow);
}
