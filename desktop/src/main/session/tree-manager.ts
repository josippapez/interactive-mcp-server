/**
 * Session-tree manager.
 *
 * Subscribes to the OpenCode `/global/sync-event` SSE stream and maintains
 * an in-memory cache of all known sessions. When the cache changes the
 * manager emits a `session-tree-updated` IPC event with a full snapshot of
 * `SessionNodeData[]` to the renderer.
 *
 * SSE events consumed:
 *   session.created.1        — add/update session in cache
 *   session.updated.1        — update session in cache
 *   session.deleted.1        — remove session from cache
 *   message.part.updated.1   — forward tool part updates to renderer
 *
 * Auto-bind (subagent support):
 *   When a `session.created.1` event arrives for a child session (parentID
 *   present) the manager looks for a recently registered MCP connection that
 *   has no `openCodeSessionId` yet, registered within AUTO_BIND_WINDOW_MS.
 *   If exactly one such connection exists it is bound to the new session ID.
 *
 * Phase 1 (SSE proactive registration):
 *   autoRegisterSession uses the sessionId directly as connectionId (no
 *   `auto-` prefix). For child sessions, the session ID is injected into the
 *   agent's OpenCode context before its first tool call so the agent knows
 *   what to pass to register_connection without being told manually.
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
import {
  getAllRegisteredConnections,
  updateConnectionProviderSession,
  upsertRegisteredConnection,
  isProviderSessionClaimed,
  type RegisteredConnection,
} from '../database';
import { injectOpenCodeMessage } from '../opencode/injector';
import {
  fetchAllOpenCodeSessions,
  type OpenCodeSession,
} from '../opencode/session';

/** How long after a register_connection call to consider a connection "pending" for auto-bind. */
const AUTO_BIND_WINDOW_MS = 3_000;

/** Reconnect delay when the SSE stream drops (ms). */
const SSE_RECONNECT_DELAY_MS = 2_000;

/** Minimum interval between snapshot emissions to avoid flooding the renderer. */
const SNAPSHOT_DEBOUNCE_MS = 50;

// ─── Sync event payload shapes ───────────────────────────────────────────────

interface SyncEventPayload {
  type: string;
  aggregate: string;
  data: Record<string, unknown>;
}

interface SyncEventEnvelope {
  payload: SyncEventPayload;
}

interface SessionInfo {
  id: string;
  parentID?: string | null;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
  /** Git version string from OpenCode (e.g., "0.0.0-work/feature-branch-123") */
  version?: string;
  /** Change summary from OpenCode */
  summary?: { additions?: number; deletions?: number; files?: number };
}

// ─── Public data types ───────────────────────────────────────────────────────

/** VCS (version control) information extracted from OpenCode session. */
export interface VcsInfo {
  /** Git branch name extracted from version string. */
  branch: string | null;
  /** Number of added lines. */
  additions: number;
  /** Number of deleted lines. */
  deletions: number;
  /** Number of changed files. */
  files: number;
}

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
  channelName: string | null;
  /** Whether this session has an active MCP channel. */
  hasMcpChannel: boolean;
  /** baseDirectory from the registered connection record, if any. */
  baseDirectory: string | null;
  /** OpenCode parent session ID from the registered connection record, if any. */
  registeredParentSessionId: string | null;
  /** Provider type for this connection (opencode, copilot-cli, claude-sdk, standalone). */
  providerType: RegisteredConnection['providerType'] | null;
  /** VCS (git) information for this session. */
  vcsInfo: VcsInfo | null;
}

// ─── In-memory state ─────────────────────────────────────────────────────────

/** Live session cache: sessionId → SessionInfo */
const _sessionCache = new Map<string, SessionInfo>();

/**
 * In-memory set of OpenCode session IDs that have been explicitly deleted by
 * the user via the Desktop app. Sessions in this set are excluded from every
 * subsequent snapshot.
 */
const _tombstonedSessionIds = new Set<string>();

/**
 * Ring buffer of recently registered connections (connectionId → timestamp).
 * Used by auto-bind to find unbound connections within AUTO_BIND_WINDOW_MS.
 */
const _pendingConnections = new Map<string, number>();

let _sseAbortController: AbortController | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let _getWindow: (() => BrowserWindow | null) | null = null;
let _getOpenCodePort: (() => number) | null = null;
let _getAutoRegisterSubagents: (() => boolean) | null = null;

// ─── Tombstone API ───────────────────────────────────────────────────────────

/**
 * Mark an OpenCode session as tombstoned so it is excluded from all future
 * session-tree snapshots.
 */
export function tombstoneOpenCodeSession(openCodeSessionId: string): void {
  _tombstonedSessionIds.add(openCodeSessionId);
  _sessionCache.delete(openCodeSessionId);
  scheduleSnapshot();
}

// ─── Pending-connection registry ─────────────────────────────────────────────

/**
 * Record a newly-registered connection as "pending" for auto-bind.
 * Called from register_connection immediately after the DB upsert.
 * Only connections without an explicit openCodeSessionId are registered here.
 */
export function recordPendingConnection(connectionId: string): void {
  _pendingConnections.set(connectionId, Date.now());
}

// ─── Depth computation ───────────────────────────────────────────────────────

function computeDepth(
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

function hasTombstonedAncestor(
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

// ─── VCS info extraction ─────────────────────────────────────────────────────

/**
 * Extract VCS (git) information from an OpenCode session.
 * The `version` field often contains a string like "0.0.0-work/feature-branch-123"
 * where the branch name follows the last hyphen-separated segment starting with a path.
 */
function extractVcsInfo(session: SessionInfo): VcsInfo | null {
  const { version, summary } = session;

  // Extract branch name from version string (e.g., "0.0.0-work/feature-branch" → "work/feature-branch")
  let branch: string | null = null;
  if (version) {
    // Pattern: version often looks like "0.0.0-branchname" or "0.0.0-path/to/branch"
    const match = version.match(/^\d+\.\d+\.\d+-(.+)$/);
    if (match) {
      branch = match[1];
    }
  }

  // If no version or summary data, return null (no VCS info available)
  if (!branch && !summary) {
    return null;
  }

  return {
    branch,
    additions: summary?.additions ?? 0,
    deletions: summary?.deletions ?? 0,
    files: summary?.files ?? 0,
  };
}

// ─── Snapshot builder ────────────────────────────────────────────────────────

function buildSnapshot(): SessionNodeData[] {
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

    const rc = byOpenCodeId.get(id) ?? null;
    const depth = computeDepth(id, depthCache);

    const title =
      session.title ?? rc?.channelName ?? `Session ${id.slice(0, 8)}`;

    result.push({
      openCodeSessionId: id,
      openCodeParentId: session.parentID ?? null,
      title,
      directory: session.directory ?? '',
      createdAt: session.time?.created ?? 0,
      updatedAt: session.time?.updated ?? 0,
      depth,
      connectionId: rc?.connectionId ?? null,
      channelName: rc?.channelName ?? null,
      hasMcpChannel: rc !== null,
      baseDirectory: rc?.baseDirectory ?? null,
      registeredParentSessionId: rc?.parentSessionId ?? null,
      providerType: rc?.providerType ?? null,
      vcsInfo: extractVcsInfo(session),
    });
  }
  return result;
}

function scheduleSnapshot(): void {
  if (_snapshotTimer !== null) return;
  _snapshotTimer = setTimeout(() => {
    _snapshotTimer = null;
    emitSnapshot();
  }, SNAPSHOT_DEBOUNCE_MS);
}

function emitSnapshot(): void {
  const win = _getWindow?.();
  if (!win || win.isDestroyed()) return;
  const snapshot = buildSnapshot();
  win.webContents.send('session-tree-updated', snapshot);
}

// ─── Auto-bind logic ─────────────────────────────────────────────────────────

function tryAutoBindSession(info: SessionInfo): void {
  // Only auto-bind child sessions.
  if (!info.parentID) return;

  const now = Date.now();
  const cutoff = now - AUTO_BIND_WINDOW_MS;

  // Expire stale pending entries first.
  for (const [connId, ts] of _pendingConnections) {
    if (ts < cutoff) _pendingConnections.delete(connId);
  }

  if (_pendingConnections.size === 0) return;

  // Find the most recently registered pending connection.
  let bestConnId: string | null = null;
  let bestTs = -1;
  for (const [connId, ts] of _pendingConnections) {
    if (ts > bestTs) {
      bestTs = ts;
      bestConnId = connId;
    }
  }

  if (!bestConnId) return;

  console.log(
    `[session-tree] auto-bind: connection=${bestConnId} → session=${info.id} (parentID=${info.parentID})`,
  );

  // Use updateConnectionProviderSession to properly handle the composite key migration
  updateConnectionProviderSession(bestConnId, info.id, 'opencode');
  _pendingConnections.delete(bestConnId);
}

// ─── Session bootstrap injection ─────────────────────────────────────────────

/**
 * Build the session bootstrap message injected into a child session's context.
 * Contains the session ID so the agent knows what to pass to register_connection.
 */
function buildSessionBootstrapMessage(
  sessionId: string,
  parentId: string,
): string {
  return (
    `<system-reminder>\n` +
    `Your OpenCode session ID is: ${sessionId}\n` +
    `Parent session ID: ${parentId}\n` +
    `Pass this as openCodeSessionId when calling register_connection.\n` +
    `</system-reminder>`
  );
}

// ─── Auto-register sessions ───────────────────────────────────────────────────

/**
 * For any session with no existing DB claim, create a synthetic
 * registered_connections record using the sessionId directly as the connectionId
 * (Phase 1: was previously `auto-{sessionId}`). This makes the channel
 * immediately visible in the sidebar and provides a stable connectionId that
 * matches the DB primary key used throughout the system.
 *
 * For child sessions (parentID present), also injects the session ID into the
 * agent's context via the OpenCode message API so the agent knows its own
 * session ID before its first tool call — eliminating the need to pass it down.
 *
 * If the agent later calls register_connection for real, upsertRegisteredConnection
 * deduplication will consolidate the record on the (providerType, providerSessionId)
 * composite key, so no orphaned rows are left behind.
 */
function autoRegisterSession(info: SessionInfo): void {
  // Only auto-register OpenCode sessions (providerType = 'opencode')
  if (isProviderSessionClaimed(info.id, 'opencode')) return;

  upsertRegisteredConnection({
    providerSessionId: info.id,
    providerType: 'opencode',
    connectionId: info.id,
    channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
    projectName: 'OpenCode',
    baseDirectory: info.directory,
    parentSessionId: info.parentID ?? undefined,
  });

  // Inject session ID into child agent context so it knows what to pass to
  // register_connection. Root sessions are handled by mcp-server.ts via
  // autoDetectOpenCodeSession, so we only inject for child sessions here.
  if (info.parentID) {
    const port = _getOpenCodePort?.() ?? 4096;
    void injectOpenCodeMessage(
      info.id,
      buildSessionBootstrapMessage(info.id, info.parentID),
      undefined,
      port,
    );
  }

  scheduleSnapshot();
}

// ─── SSE event handling ───────────────────────────────────────────────────────

function handleSyncEvent(envelope: SyncEventEnvelope): void {
  const { type, data } = envelope.payload;

  if (type === 'session.created.1') {
    const info = data['info'] as SessionInfo | undefined;
    const sessionId = data['sessionID'] as string | undefined;
    if (!sessionId || !info) return;

    const merged: SessionInfo = { ...info, id: sessionId };
    if (!_tombstonedSessionIds.has(sessionId)) {
      _sessionCache.set(sessionId, merged);
      tryAutoBindSession(merged);
      if (_getAutoRegisterSubagents?.() ?? true) {
        autoRegisterSession(merged);
      }
      scheduleSnapshot();
    }
    return;
  }

  if (type === 'session.updated.1') {
    const sessionId = data['sessionID'] as string | undefined;
    const info = data['info'] as Partial<SessionInfo> | undefined;
    if (!sessionId) return;

    const existing = _sessionCache.get(sessionId);
    if (existing && info) {
      // Merge partial updates — OpenCode sends sparse patches.
      _sessionCache.set(sessionId, { ...existing, ...info, id: sessionId });
      scheduleSnapshot();
    }
    return;
  }

  if (type === 'session.deleted.1') {
    const sessionId = data['sessionID'] as string | undefined;
    if (!sessionId) return;
    _sessionCache.delete(sessionId);
    scheduleSnapshot();
    return;
  }

  // Forward message part updates to renderer (for tool call streaming)
  if (type === 'message.part.updated.1') {
    const part = data['part'] as Record<string, unknown> | undefined;
    const sessionID = data['sessionID'] as string | undefined;
    if (!part || !sessionID) return;

    const win = _getWindow?.();
    if (!win || win.isDestroyed()) return;

    // Extract messageID from the part (OpenCode parts have messageID property)
    const messageID = part['messageID'] as string | undefined;

    win.webContents.send('conversation-part-event', {
      type: 'part.updated',
      sessionId: sessionID,
      messageId: messageID,
      part: {
        id: part['id'] as string,
        type: mapPartType(part['type'] as string),
        text: part['text'] as string | undefined,
        toolName: part['tool'] as string | undefined,
        toolCallId: part['callID'] as string | undefined,
        toolInput: (part['state'] as Record<string, unknown> | undefined)?.[
          'input'
        ] as Record<string, unknown> | undefined,
        toolOutput: (part['state'] as Record<string, unknown> | undefined)?.[
          'output'
        ] as string | undefined,
        toolStatus: mapToolStatus(
          (part['state'] as Record<string, unknown> | undefined)?.['status'] as
            | string
            | undefined,
        ),
      },
    });
    return;
  }
}

// ─── Part type mapping helpers ────────────────────────────────────────────────

function mapPartType(
  type: string | undefined,
):
  | 'text'
  | 'tool-call'
  | 'tool-result'
  | 'image'
  | 'file'
  | 'step-start'
  | 'step-end'
  | 'unknown' {
  switch (type) {
    case 'text':
      return 'text';
    case 'tool':
      return 'tool-call';
    case 'tool-result':
      return 'tool-result';
    case 'image':
      return 'image';
    case 'file':
      return 'file';
    case 'step-start':
      return 'step-start';
    case 'step-end':
      return 'step-end';
    default:
      return 'unknown';
  }
}

function mapToolStatus(
  status: string | undefined,
): 'pending' | 'running' | 'completed' | 'error' | undefined {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}

// ─── Initial REST seed ────────────────────────────────────────────────────────

/**
 * Seed the in-memory cache with all sessions currently known to OpenCode.
 * Called once after the SSE connection is established so that sessions created
 * before this app session started are immediately visible.
 *
 * If the API is unreachable (returns null), the cache stays empty and the app
 * renders as-is — the user will see sessions appear as new events arrive.
 */
async function seedCacheFromRest(openCodePort: number): Promise<void> {
  const sessions = await fetchAllOpenCodeSessions(openCodePort);
  if (!sessions) return; // API unreachable — skip silently

  let seeded = 0;
  for (const session of sessions) {
    if (_tombstonedSessionIds.has(session.id)) continue;
    const info: SessionInfo = {
      id: session.id,
      parentID: session.parentID ?? null,
      title: (session as SessionInfo & { title?: string }).title,
      directory: (session as SessionInfo & { directory?: string }).directory,
      time: session.time,
    };
    _sessionCache.set(session.id, info);
    if (_getAutoRegisterSubagents?.() ?? true) {
      autoRegisterSession(info);
    }
    seeded++;
  }

  if (seeded > 0) {
    console.log(`[session-tree] seeded ${seeded} sessions from REST`);
    scheduleSnapshot();
  }
}

// ─── SSE subscription ─────────────────────────────────────────────────────────

async function subscribeToSyncEvents(openCodePort: number): Promise<void> {
  const url = `http://localhost:${openCodePort}/global/sync-event`;
  const controller = new AbortController();
  _sseAbortController = controller;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    });

    if (!res.ok || !res.body) {
      console.warn(
        `[session-tree] SSE connect failed: ${res.status} — will retry in ${SSE_RECONNECT_DELAY_MS}ms`,
      );
      scheduleReconnect();
      return;
    }

    console.log(`[session-tree] SSE connected to ${url}`);

    // Seed the cache with sessions that already existed before we connected.
    await seedCacheFromRest(openCodePort);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are terminated by a double newline.
      const frames = buffer.split(/\n\n/);
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;

        const raw = dataLine.slice('data:'.length).trim();
        if (!raw) continue;

        try {
          const envelope = JSON.parse(raw) as SyncEventEnvelope;
          if (envelope?.payload?.type) {
            handleSyncEvent(envelope);
          }
        } catch {
          // malformed JSON — ignore
        }
      }
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') return; // intentional stop
    console.warn(`[session-tree] SSE error:`, err);
  }

  scheduleReconnect();
}

function scheduleReconnect(): void {
  if (_reconnectTimer !== null || _sseAbortController === null) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    const port = _getOpenCodePort?.() ?? 4096;
    void subscribeToSyncEvents(port);
  }, SSE_RECONNECT_DELAY_MS);
}

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
  if (_sseAbortController !== null) return;

  _getWindow = getWindow;
  _getOpenCodePort = getOpenCodePort;
  _getAutoRegisterSubagents = getAutoRegisterSubagents ?? null;

  void subscribeToSyncEvents(getOpenCodePort());
}

/** Stop the SSE subscription and clean up all timers. */
export function stopSessionTreeManager(): void {
  _sseAbortController?.abort();
  _sseAbortController = null;

  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_snapshotTimer !== null) {
    clearTimeout(_snapshotTimer);
    _snapshotTimer = null;
  }

  _getWindow = null;
  _getOpenCodePort = null;
  _getAutoRegisterSubagents = null;
}

/**
 * Force an immediate re-snapshot and emit `session-tree-updated`.
 * Called after register_connection so the renderer sees the update right away.
 */
export async function triggerSessionTreeUpdate(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  const snapshot = buildSnapshot();
  win.webContents.send('session-tree-updated', snapshot);
}

/**
 * Re-seeds the session cache from the OpenCode REST API and emits a fresh
 * snapshot. Called on demand when the user clicks the refresh button in the
 * sidebar. Uses the currently configured OpenCode port (or default 4096).
 */
export async function refreshSessionTreeCache(): Promise<void> {
  const port = _getOpenCodePort?.() ?? 4096;
  await seedCacheFromRest(port);
}

// ─── Exported for backwards-compat (session-reconnect uses this type) ─────────
export type { OpenCodeSession };
