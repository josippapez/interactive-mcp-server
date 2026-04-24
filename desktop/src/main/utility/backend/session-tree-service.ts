/**
 * Session-tree service (simplified replacement for the legacy tree-manager).
 *
 * Design: OpenCode REST + the local DB are the sources of truth. The main
 * process holds no long-lived session cache. When the renderer needs the
 * tree it calls `getSessionTree()` (IPC `get-session-tree`), which fetches
 * fresh data. When something changes (SSE session lifecycle event, manual
 * mutation), main fires a payload-free `session-tree-invalidated` event and
 * the renderer refetches on its own schedule.
 *
 * Responsibilities:
 *   - Build a SessionNodeData[] on demand from REST + DB.
 *   - Notify the renderer when the data has changed so it can refetch.
 *   - Manage the `selectedFolder` that scopes REST queries.
 *   - Expose tombstoneOpenCodeSession for user-deletions (persisted in-memory
 *     for the lifetime of the app session — late SSE events can't resurrect
 *     user-deleted sessions).
 *
 * What this replaces:
 *   - tree-manager/state.ts (cache, tombstones, debounce timer, emit counters)
 *   - tree-manager/snapshot.ts (scheduleSnapshot, emitSnapshot, optimistic)
 *   - tree-manager/rest-seed.ts (retry loop — no longer needed; renderer
 *     handles loading state on its own)
 *   - tree-manager/event-handlers.ts (SSE -> cache -> debounce)
 *   - tree-manager/tree-poller.ts (SSE covers this)
 *   - 8+ triggerSessionTreeUpdate callers (replaced with invalidate())
 */

import {
  getAllRegisteredConnections,
  getPinnedProjects,
  type RegisteredConnection,
} from './database';
import {
  fetchAllOpenCodeSessions,
  fetchSessionsForDirectory,
  type OpenCodeSession,
} from './session';
import type { SessionInfo } from './session-types';
import type { SessionNodeData } from './session-types';
import { extractVcsInfo } from './vcs';
import { createLogger } from '../../utils/logger';
import { createKeyedDebouncer } from './debounce-tree-invalidate';
import { getMainRpcOrNull } from './rpc';

const log = createLogger('session-tree-service');
void log;

// ─── Module state ────────────────────────────────────────────────────────────

interface ServiceState {
  getOpenCodePort: (() => number) | null;
  /** Currently selected project folder (null = empty sidebar state). */
  selectedFolder: string | null;
  /** User-deleted sessions; excluded from every build until restart. */
  tombstones: Set<string>;
  /** Coalesce rapid invalidate() bursts into one IPC event per ~50 ms. */
  invalidateTimer: ReturnType<typeof setTimeout> | null;
}

const state: ServiceState = {
  getOpenCodePort: null,
  selectedFolder: null,
  tombstones: new Set(),
  invalidateTimer: null,
};

const INVALIDATE_COALESCE_MS = 50;
const KEYED_INVALIDATE_DEBOUNCE_MS = 200;

/**
 * Per-key debouncer used by `invalidateSessionTreeForKey`. SSE bursts during
 * agent file edits can fire dozens of `session.updated` events per second per
 * session; keying by providerSessionId / connectionId means bursts on one
 * session do not delay invalidations for unrelated sessions.
 */
const keyedInvalidateDebouncer = createKeyedDebouncer({
  windowMs: KEYED_INVALIDATE_DEBOUNCE_MS,
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startSessionTreeService(getOpenCodePort: () => number): void {
  state.getOpenCodePort = getOpenCodePort;
}

export function stopSessionTreeService(): void {
  if (state.invalidateTimer !== null) {
    clearTimeout(state.invalidateTimer);
    state.invalidateTimer = null;
  }
  keyedInvalidateDebouncer.cancelAll();
  state.getOpenCodePort = null;
}

// ─── Selected folder ─────────────────────────────────────────────────────────

export function getSelectedFolder(): string | null {
  return state.selectedFolder;
}

export function setSelectedFolder(folder: string | null): void {
  if (state.selectedFolder === folder) return;
  state.selectedFolder = folder;
  invalidateSessionTree();
}

// ─── Tombstones ──────────────────────────────────────────────────────────────

export function tombstoneOpenCodeSession(openCodeSessionId: string): void {
  state.tombstones.add(openCodeSessionId);
  invalidateSessionTree();
}

export function isTombstoned(openCodeSessionId: string): boolean {
  return state.tombstones.has(openCodeSessionId);
}

// ─── Invalidation ────────────────────────────────────────────────────────────

/**
 * Notify the renderer that the session tree may have changed. Coalesces
 * bursts so a flurry of SSE events (e.g. rapid session.updated during a
 * prompt stream) produce at most one IPC event per ~50 ms.
 */
export function invalidateSessionTree(): void {
  if (state.invalidateTimer !== null) return;
  state.invalidateTimer = setTimeout(() => {
    state.invalidateTimer = null;
    const rpc = getMainRpcOrNull();
    if (!rpc) return;
    rpc.emit('to-renderer', {
      channel: 'session-tree-invalidated',
      payload: undefined,
    });
  }, INVALIDATE_COALESCE_MS);
}

/**
 * Keyed variant: coalesces a burst of invalidations from a single source
 * (e.g. one provider session emitting many SSE events) into a single
 * trailing-edge invalidation. Different keys do not block each other.
 *
 * Use this from hot SSE paths where a single session can fire many events
 * per second (e.g. file-edit streams). Use `invalidateSessionTree()`
 * directly for one-shot mutations like manual deletes / pinning.
 */
export function invalidateSessionTreeForKey(key: string): void {
  keyedInvalidateDebouncer.schedule(key, invalidateSessionTree);
}

// ─── Build ───────────────────────────────────────────────────────────────────

/**
 * Build the current session tree. Called by the `get-session-tree` IPC
 * handler whenever the renderer refetches. No caching — OpenCode REST + DB
 * are the sources of truth.
 *
 * When a folder is selected, scope to that directory. When no folder is
 * selected (default "All projects" view), fan out across unscoped + all
 * pinned-project directories so subagents and existing sessions appear
 * eagerly without requiring a manual folder click.
 *
 * Returns an empty array when OpenCode is unreachable.
 */
export async function fetchSessionTree(): Promise<SessionNodeData[]> {
  const folder = state.selectedFolder;
  const port = state.getOpenCodePort?.() ?? 4096;

  let sessions: OpenCodeSession[] | null;
  if (folder) {
    sessions = await fetchSessionsForDirectory(port, folder);
  } else {
    // No folder selected — fall back to an aggregate view across all
    // pinned-project directories. `fetchAllOpenCodeSessions` performs an
    // unscoped list plus per-directory lists and deduplicates results.
    const pinnedDirectories = getPinnedProjects().map((p) => p.path);
    sessions = await fetchAllOpenCodeSessions(port, pinnedDirectories);
  }
  if (!sessions) return [];

  const registeredConnections = getAllRegisteredConnections();
  const byOpenCodeId = new Map<string, RegisteredConnection>(
    registeredConnections
      .filter((rc) => rc.providerSessionId !== null)
      .map((rc) => [rc.providerSessionId as string, rc]),
  );

  // Build a session lookup we can walk for depth + tombstone-ancestor checks.
  const sessionById = new Map<string, OpenCodeSession>();
  for (const s of sessions) {
    if (!state.tombstones.has(s.id)) sessionById.set(s.id, s);
  }

  const depthCache = new Map<string, number>();
  const result: SessionNodeData[] = [];

  for (const [id, session] of sessionById) {
    if (hasTombstonedAncestor(id, sessionById)) continue;
    result.push(
      buildSessionNodeData(
        id,
        session,
        byOpenCodeId.get(id) ?? null,
        sessionById,
        depthCache,
      ),
    );
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasTombstonedAncestor(
  sessionId: string,
  sessionById: Map<string, OpenCodeSession>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(sessionId)) return false;
  visited.add(sessionId);
  const session = sessionById.get(sessionId);
  if (!session?.parentID) return false;
  if (state.tombstones.has(session.parentID)) return true;
  return hasTombstonedAncestor(session.parentID, sessionById, visited);
}

function computeDepth(
  sessionId: string,
  sessionById: Map<string, OpenCodeSession>,
  cache: Map<string, number>,
  visited = new Set<string>(),
): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  if (visited.has(sessionId)) return 0; // cycle guard
  visited.add(sessionId);

  const session = sessionById.get(sessionId);
  if (!session?.parentID) {
    cache.set(sessionId, 0);
    return 0;
  }
  const depth = computeDepth(session.parentID, sessionById, cache, visited) + 1;
  cache.set(sessionId, depth);
  return depth;
}

function buildSessionNodeData(
  sessionId: string,
  session: OpenCodeSession,
  rc: RegisteredConnection | null,
  sessionById: Map<string, OpenCodeSession>,
  depthCache: Map<string, number>,
): SessionNodeData {
  // Coerce to the SessionInfo shape expected by extractVcsInfo.
  const info: SessionInfo = {
    id: sessionId,
    parentID: session.parentID ?? null,
    title: session.title,
    directory: session.directory,
    time: session.time,
    version: session.version,
    summary: session.summary,
  };
  return {
    providerSessionId: sessionId,
    openCodeParentId: session.parentID ?? null,
    title: session.title ?? `Session ${sessionId.slice(0, 8)}`,
    directory: session.directory ?? '',
    createdAt: session.time?.created ?? 0,
    updatedAt: session.time?.updated ?? 0,
    depth: computeDepth(sessionId, sessionById, depthCache),
    connectionId: rc?.connectionId ?? null,
    channelName: rc?.channelName ?? null,
    hasMcpChannel: rc !== null,
    baseDirectory: rc?.baseDirectory ?? null,
    registeredParentSessionId: rc?.parentSessionId ?? null,
    // This function is only called while iterating OpenCode sessions
    // (see `buildSessionTree` caller). Every node here is an OpenCode
    // session by construction, so `providerType` is always 'opencode'.
    // Do NOT inherit from the RegisteredConnection — subagent sessions
    // have no registered-connection row and would otherwise fall through
    // to `null`, which disables `isOpenCodeSession` downstream and hides
    // the chat history + model selector.
    providerType: 'opencode',
    vcsInfo: extractVcsInfo(info),
  };
}

// ─── End ─────────────────────────────────────────────────────────────────────
