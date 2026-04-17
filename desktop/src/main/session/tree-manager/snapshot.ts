/**
 * Snapshot builder: assembles SessionNodeData[] from the in-memory cache and
 * registered_connections table, and emits `session-tree-updated` IPC events.
 */

import {
  getAllRegisteredConnections,
  type RegisteredConnection,
} from '../../database';
import { createLogger } from '../../utils/logger';
import { _sessionCache, _tombstonedSessionIds, state } from './state';
import {
  SNAPSHOT_DEBOUNCE_MS,
  type SessionInfo,
  type SessionNodeData,
} from './types';
import { extractVcsInfo } from './vcs';

const log = createLogger('session-tree');

// ─── Depth computation ───────────────────────────────────────────────────────

export function computeDepth(
  sessionId: string,
  cache: Map<string, number> = new Map(),
  visited = new Set<string>(),
): number {
  if (cache.has(sessionId)) return cache.get(sessionId)!;
  if (visited.has(sessionId)) return 0; // cycle guard
  visited.add(sessionId);

  const session = _sessionCache.get(sessionId);
  if (!session?.parentID) {
    cache.set(sessionId, 0);
    return 0;
  }
  const parentDepth = computeDepth(session.parentID, cache, visited);
  const depth = parentDepth + 1;
  cache.set(sessionId, depth);
  return depth;
}

export function hasTombstonedAncestor(
  sessionId: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(sessionId)) return false;
  visited.add(sessionId);
  const session = _sessionCache.get(sessionId);
  if (!session?.parentID) return false;
  if (_tombstonedSessionIds.has(session.parentID)) return true;
  return hasTombstonedAncestor(session.parentID, visited);
}

// ─── Node builder ────────────────────────────────────────────────────────────

export function buildSessionNodeData(
  sessionId: string,
  session: SessionInfo,
  rc: RegisteredConnection | null,
  depthCache: Map<string, number> = new Map(),
): SessionNodeData {
  return {
    providerSessionId: sessionId,
    openCodeParentId: session.parentID ?? null,
    title: session.title ?? `Session ${sessionId.slice(0, 8)}`,
    directory: session.directory ?? '',
    createdAt: session.time?.created ?? 0,
    updatedAt: session.time?.updated ?? 0,
    depth: computeDepth(sessionId, depthCache),
    connectionId: rc?.connectionId ?? null,
    channelName: rc?.channelName ?? null,
    hasMcpChannel: rc !== null,
    baseDirectory: rc?.baseDirectory ?? null,
    registeredParentSessionId: rc?.parentSessionId ?? null,
    providerType: rc?.providerType ?? null,
    vcsInfo: extractVcsInfo(session),
  };
}

export function findRegisteredConnectionForSession(
  openCodeSessionId: string,
): RegisteredConnection | null {
  return (
    getAllRegisteredConnections().find(
      (entry) => entry.providerSessionId === openCodeSessionId,
    ) ?? null
  );
}

// ─── Snapshot builder ────────────────────────────────────────────────────────

export function buildSnapshot(): SessionNodeData[] {
  const registeredConnections = getAllRegisteredConnections();

  // Build lookup by providerSessionId (which equals openCodeSessionId for OpenCode connections)
  const byOpenCodeId = new Map(
    registeredConnections
      .filter((rc) => rc.providerSessionId !== null)
      .map((rc) => [rc.providerSessionId as string, rc]),
  );

  const depthCache = new Map<string, number>();

  const result: SessionNodeData[] = [];
  for (const [id, session] of _sessionCache) {
    if (_tombstonedSessionIds.has(id)) continue;
    if (hasTombstonedAncestor(id)) continue;

    result.push(
      buildSessionNodeData(
        id,
        session,
        byOpenCodeId.get(id) ?? null,
        depthCache,
      ),
    );
  }
  return result;
}

// ─── Emission ────────────────────────────────────────────────────────────────

export function emitOptimisticChildSession(info: SessionInfo): void {
  if (!info.parentID) return;
  if (_tombstonedSessionIds.has(info.id)) return;
  if (hasTombstonedAncestor(info.id)) return;

  const win = state.getWindow?.();
  if (!win || win.isDestroyed()) return;

  win.webContents.send(
    'session-node-created-optimistic',
    buildSessionNodeData(
      info.id,
      info,
      findRegisteredConnectionForSession(info.id),
    ),
  );
}

export function scheduleSnapshot(): void {
  // If a timer is already scheduled, reschedule it to capture the latest state
  // (trailing-edge debounce). This ensures rapid updates don't lose data.
  if (state.snapshotTimer !== null) {
    clearTimeout(state.snapshotTimer);
    log.debug('scheduleSnapshot: rescheduling snapshot (timer was pending)');
  } else {
    log.debug(
      `scheduleSnapshot: scheduling snapshot in ${SNAPSHOT_DEBOUNCE_MS}ms`,
    );
  }

  // If there was a pending snapshot from a failed emit (window unavailable),
  // and the window is now available, emit immediately to recover.
  if (state.snapshotPending) {
    const win = state.getWindow?.();
    if (win && !win.isDestroyed()) {
      log.info('scheduleSnapshot: recovering pending snapshot');
      state.snapshotTimer = setTimeout(() => {
        state.snapshotTimer = null;
        emitSnapshot();
      }, 0); // Emit immediately
      return;
    }
  }

  state.snapshotTimer = setTimeout(() => {
    state.snapshotTimer = null;
    emitSnapshot();
  }, SNAPSHOT_DEBOUNCE_MS);
}

export function emitSnapshot(): void {
  const win = state.getWindow?.();
  if (!win || win.isDestroyed()) {
    log.warn(
      'emitSnapshot: window not available or destroyed — marking pending',
    );
    state.snapshotPending = true;
    return;
  }
  state.snapshotPending = false;
  const snapshot = buildSnapshot();
  const childSessions = snapshot.filter((s) => s.openCodeParentId !== null);
  log.info(
    `emitSnapshot: emitting ${snapshot.length} sessions (${childSessions.length} children) to renderer`,
  );
  if (childSessions.length > 0) {
    log.info(
      `emitSnapshot: child sessions: ${childSessions.map((s) => `${s.providerSessionId}(parent=${s.openCodeParentId})`).join(', ')}`,
    );
  }
  win.webContents.send('session-tree-updated', snapshot);
}
