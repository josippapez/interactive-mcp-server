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

import { createLogger } from '../../utils/logger';
import {
  getAllRegisteredConnections,
  getPinnedProjects,
  type RegisteredConnection,
} from './database';
import { createKeyedDebouncer } from './debounce-tree-invalidate';
import { getMainRpcOrNull } from './rpc';
import {
  archiveOpenCodeSession,
  expandOpenCodeSessionTree,
  fetchRootSessionsForDirectory,
  type OpenCodeSession,
} from './session';
import type {
  SessionInfo,
  SessionNodeData,
  SessionTreeResult,
} from './session-types';
import { extractVcsInfo } from './vcs';
import { fetchVcsInfo } from './vcs-api';
import { startMissingIndexForBaseDirectory } from './repository-index/autostart';

const log = createLogger('session-tree-service');
void log;

const INVALIDATE_COALESCE_MS = 50;
const KEYED_INVALIDATE_DEBOUNCE_MS = 200;
const SESSION_RECENT_LIMIT = 10;
const SESSION_LOAD_MORE_STEP = 5;

// ─── Module state ────────────────────────────────────────────────────────────

interface ServiceState {
  getOpenCodePort: (() => number) | null;
  /** Currently selected project folder (null = empty sidebar state). */
  selectedFolder: string | null;
  /** Whether the session tree should show archived OpenCode sessions. */
  showArchivedSessions: boolean;
  /** Root-session page size per base directory. */
  sessionLimitsByDirectory: Map<string, number>;
  /** User-deleted sessions; excluded from every build until restart. */
  tombstones: Set<string>;
  /** Coalesce rapid invalidate() bursts into one IPC event per ~50 ms. */
  invalidateTimer: ReturnType<typeof setTimeout> | null;
}

const state: ServiceState = {
  getOpenCodePort: null,
  selectedFolder: null,
  showArchivedSessions: false,
  sessionLimitsByDirectory: new Map(),
  tombstones: new Set(),
  invalidateTimer: null,
};

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

/**
 * Returns the current OpenCode HTTP port if the session-tree service has been
 * started; otherwise `null`. Other backend modules (e.g. `manage-memories`)
 * use this accessor to inject messages into OpenCode without threading the
 * port through every call site.
 */
export function getOpenCodePort(): number | null {
  return state.getOpenCodePort?.() ?? null;
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

export function getShowArchivedSessions(): boolean {
  return state.showArchivedSessions;
}

export function setShowArchivedSessions(showArchived: boolean): void {
  if (state.showArchivedSessions === showArchived) return;
  state.showArchivedSessions = showArchived;
  invalidateSessionTree();
}

export async function setOpenCodeSessionArchived(
  openCodeSessionId: string,
  archived: boolean,
): Promise<boolean> {
  const port = state.getOpenCodePort?.() ?? 4096;
  const ok = await archiveOpenCodeSession(port, openCodeSessionId, archived);
  if (ok) invalidateSessionTree();
  return ok;
}

export function increaseSessionTreeLimit(baseDirectory: string): number {
  const key = normalizeDirectoryKey(baseDirectory);
  const next = getSessionLimitForDirectory(key) + SESSION_LOAD_MORE_STEP;
  state.sessionLimitsByDirectory.set(key, next);
  invalidateSessionTree();
  return next;
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
 * Always returns the per-pinned-directory list, deduplicated. Each pinned
 * folder is fetched with its own page size so load-more is scoped to that
 * folder instead of expanding every project at once.
 *
 * `selectedFolder` is retained as renderer-facing state but pinned folders,
 * not the selected folder, scope REST queries.
 *
 * Returns `null` when the OpenCode REST fetch failed (server unreachable
 * or transient error). The renderer treats `null` as "retry shortly" and
 * `[]` as "no sessions exist". Without this distinction the sidebar would
 * blank out on every transient cold-start fetch failure.
 */
export async function fetchSessionTree(): Promise<SessionTreeResult | null> {
  const port = state.getOpenCodePort?.() ?? 4096;

  const pinnedDirectories = getPinnedProjects()
    .map((p) => normalizeDirectoryKey(p.path))
    .filter(Boolean);
  const registeredConnections = getAllRegisteredConnections();
  const directories = Array.from(new Set(pinnedDirectories));
  for (const directory of directories) {
    startMissingIndexForBaseDirectory(directory);
  }

  const pages = await Promise.all(
    directories.map(async (directory) => {
      const limit = getSessionLimitForDirectory(directory);
      const roots = await fetchRootSessionsForDirectory(
        port,
        directory,
        limit,
        state.showArchivedSessions,
      );
      const visibleRoots = roots?.filter((session) =>
        state.showArchivedSessions
          ? Boolean(session.time?.archived)
          : !session.time?.archived,
      );
      return visibleRoots
        ? {
            directory,
            limit,
            roots: visibleRoots,
            archived: state.showArchivedSessions,
            hasMore: roots.length >= limit,
          }
        : null;
    }),
  );
  if (pages.some((page) => page === null)) return null;

  const projectPages = pages.map((page) => {
    return {
      path: page!.directory,
      limit: page!.limit,
      hasMore: page!.hasMore,
      archived: page!.archived,
    };
  });
  const rootSessions = pages.flatMap((page) => page!.roots);
  const hasMore = projectPages.some((page) => page.hasMore);
  const sessions = includeRegisteredOpenCodeChildren(
    await expandOpenCodeSessionTree(port, rootSessions),
    registeredConnections,
  );

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
  const vcsByDirectory = await fetchSdkVcsByDirectory(
    port,
    sessions,
    registeredConnections,
  );

  for (const [id, session] of sessionById) {
    if (hasTombstonedAncestor(id, sessionById)) continue;
    const registered = byOpenCodeId.get(id) ?? null;
    result.push(
      buildSessionNodeData(
        id,
        session,
        registered,
        sessionById,
        depthCache,
        vcsByDirectory.get(
          registered?.baseDirectory ?? session.directory ?? '',
        ) ?? null,
      ),
    );
  }
  return {
    nodes: result,
    limit: SESSION_RECENT_LIMIT,
    hasMore,
    projectPages,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDirectoryKey(directory: string | null | undefined): string {
  return directory?.trim() ?? '';
}

function getSessionLimitForDirectory(directory: string): number {
  return state.sessionLimitsByDirectory.get(directory) ?? SESSION_RECENT_LIMIT;
}

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

function includeRegisteredOpenCodeChildren(
  sessions: OpenCodeSession[],
  registeredConnections: RegisteredConnection[],
): OpenCodeSession[] {
  const sessionById = new Map<string, OpenCodeSession>(
    sessions.map((session) => [session.id, session]),
  );

  for (const connection of registeredConnections) {
    if (
      connection.providerType !== 'opencode' ||
      !connection.providerSessionId ||
      !connection.parentSessionId ||
      sessionById.has(connection.providerSessionId) ||
      !sessionById.has(connection.parentSessionId)
    ) {
      continue;
    }

    const parent = sessionById.get(connection.parentSessionId);
    sessionById.set(connection.providerSessionId, {
      id: connection.providerSessionId,
      parentID: connection.parentSessionId,
      title: connection.channelName,
      directory: connection.baseDirectory ?? parent?.directory,
      time: {
        created: Date.parse(connection.createdAt) || parent?.time?.created || 0,
        updated: Date.parse(connection.updatedAt) || parent?.time?.updated || 0,
      },
    });
  }

  return Array.from(sessionById.values());
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
  sdkVcsInfo: SessionNodeData['vcsInfo'],
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
    archivedAt: session.time?.archived ?? null,
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
    vcsInfo: sdkVcsInfo ?? extractVcsInfo(info),
  };
}

async function fetchSdkVcsByDirectory(
  port: number,
  sessions: OpenCodeSession[],
  registeredConnections: RegisteredConnection[],
): Promise<Map<string, SessionNodeData['vcsInfo']>> {
  const directories = new Set<string>();
  for (const session of sessions) {
    if (session.directory) directories.add(session.directory);
  }
  for (const connection of registeredConnections) {
    if (connection.baseDirectory) directories.add(connection.baseDirectory);
  }

  const entries = await Promise.allSettled(
    [...directories].map(async (directory) => ({
      directory,
      vcsInfo: await fetchVcsInfo(port, directory),
    })),
  );

  const result = new Map<string, SessionNodeData['vcsInfo']>();
  for (const entry of entries) {
    if (entry.status === 'fulfilled' && entry.value.vcsInfo) {
      result.set(entry.value.directory, entry.value.vcsInfo);
    }
  }
  return result;
}

// ─── End ─────────────────────────────────────────────────────────────────────
