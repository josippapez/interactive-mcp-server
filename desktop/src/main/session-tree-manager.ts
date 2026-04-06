/**
 * Session-tree manager.
 *
 * Polls the OpenCode HTTP API every POLL_INTERVAL_MS and emits a
 * `session-tree-updated` IPC event with a full snapshot of `SessionNodeData[]`.
 *
 * The renderer rebuilds its entire session map from this snapshot — there is
 * no incremental diff logic on either side.
 *
 * Design:
 * - Every OpenCode session with a matching registered_connections row gets
 *   `hasMcpChannel: true` and inherits the agent's display name.
 * - Sessions that have no registered connection appear with their OpenCode
 *   title (or a generated fallback) and `hasMcpChannel: false`.
 * - `depth` is computed from the parentID chain (root = 0).
 * - The snapshot is always the full flat list — the renderer is responsible
 *   for building the tree view.
 */

import type { BrowserWindow } from 'electron';
import { getAllRegisteredConnections } from './database';
import {
  fetchAllOpenCodeSessions,
  type OpenCodeSession,
} from './opencode-session';

const POLL_INTERVAL_MS = 2_000;

/** The data shape emitted over IPC to the renderer per session. */
export interface SessionNodeData {
  /** OpenCode session ID — stable primary key. */
  openCodeSessionId: string;
  /** Parent's OpenCode session ID, or null for root sessions. */
  openCodeParentId: string | null;
  /** Human-readable title from OpenCode (may be auto-generated). */
  title: string;
  /** Working directory reported by OpenCode. */
  directory: string;
  /** Unix ms timestamp from OpenCode. */
  createdAt: number;
  /** Unix ms timestamp from OpenCode. */
  updatedAt: number;
  /** 0 = root/main agent, 1 = direct subagent, etc. */
  depth: number;
  /**
   * MCP connectionId — set when the agent called register_connection.
   * This is the key used by prompt/channel events.
   */
  connectionId: string | null;
  /** Display name from register_connection, or null if not yet registered. */
  agentName: string | null;
  /** Whether this session has an active MCP channel. */
  hasMcpChannel: boolean;
  /** baseDirectory from the registered connection record, if any. */
  baseDirectory: string | null;
  /** OpenCode parent session ID from the registered connection record, if any. */
  registeredParentSessionId: string | null;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function collectFallbackDirectories(): string[] {
  return Array.from(
    new Set(
      getAllRegisteredConnections()
        .map((rc) => rc.baseDirectory)
        .filter((dir): dir is string => !!dir && dir.trim().length > 0),
    ),
  );
}

/** Compute depth (0 = root) from a flat session array. */
function computeDepth(
  sessionId: string,
  byId: Map<string, OpenCodeSession>,
  cache: Map<string, number>,
): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  const session = byId.get(sessionId);
  if (!session || !session.parentID) {
    cache.set(sessionId, 0);
    return 0;
  }
  const parentDepth = computeDepth(session.parentID, byId, cache);
  const depth = parentDepth + 1;
  cache.set(sessionId, depth);
  return depth;
}

function buildSnapshot(allSessions: OpenCodeSession[]): SessionNodeData[] {
  const registeredConnections = getAllRegisteredConnections();

  // Index registered connections by openCodeSessionId for O(1) lookup.
  const byOpenCodeId = new Map(
    registeredConnections
      .filter((rc) => rc.openCodeSessionId !== null)
      .map((rc) => [rc.openCodeSessionId as string, rc]),
  );

  // Index sessions by id for depth computation.
  const sessionsById = new Map(allSessions.map((s) => [s.id, s]));
  const depthCache = new Map<string, number>();

  return allSessions.map((session): SessionNodeData => {
    const rc = byOpenCodeId.get(session.id) ?? null;
    const depth = computeDepth(session.id, sessionsById, depthCache);

    // Build a readable title: use OpenCode title field if present,
    // fall back to registered agent name, then to a truncated ID.
    const title =
      (session as OpenCodeSession & { title?: string; summary?: string })
        .title ??
      (session as OpenCodeSession & { summary?: string }).summary ??
      rc?.agentName ??
      `Session ${session.id.slice(0, 8)}`;

    return {
      openCodeSessionId: session.id,
      openCodeParentId: session.parentID ?? null,
      title,
      directory:
        (session as OpenCodeSession & { directory?: string }).directory ?? '',
      createdAt: session.time?.created ?? 0,
      updatedAt: session.time?.updated ?? 0,
      depth,
      connectionId: rc?.connectionId ?? null,
      agentName: rc?.agentName ?? null,
      hasMcpChannel: rc !== null,
      baseDirectory: rc?.baseDirectory ?? null,
      registeredParentSessionId: rc?.parentSessionId ?? null,
    };
  });
}

/**
 * Start the session-tree sync loop.
 * Safe to call multiple times — subsequent calls are no-ops until stop is called.
 */
export function startSessionTreeManager(
  getWindow: () => BrowserWindow | null,
  getOpenCodePort: () => number,
): void {
  if (pollTimer !== null) return;

  const tick = async (): Promise<void> => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;

    const allSessions = await fetchAllOpenCodeSessions(
      getOpenCodePort(),
      collectFallbackDirectories(),
    );
    if (!allSessions) return; // API unreachable — skip this tick silently

    const snapshot = buildSnapshot(allSessions);
    win.webContents.send('session-tree-updated', snapshot);
  };

  // Run immediately, then on interval
  void tick();
  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

/** Stop the sync loop and clean up the timer. */
export function stopSessionTreeManager(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Force an immediate re-snapshot and emit `session-tree-updated`.
 * Called after register_connection so the renderer sees the update right away.
 */
export async function triggerSessionTreeUpdate(
  getWindow: () => BrowserWindow | null,
  getOpenCodePort: () => number,
): Promise<void> {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;

  const allSessions = await fetchAllOpenCodeSessions(
    getOpenCodePort(),
    collectFallbackDirectories(),
  );
  if (!allSessions) return;

  const snapshot = buildSnapshot(allSessions);
  win.webContents.send('session-tree-updated', snapshot);
}
