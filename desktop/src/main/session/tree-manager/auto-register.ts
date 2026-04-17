/**
 * Auto-register and auto-bind logic for OpenCode sessions.
 *
 * - autoRegisterSession: create a registered_connections row with connection_id=NULL
 *   for any new OpenCode session, so it appears in the sidebar immediately.
 * - tryAutoBindSession: if a pending transport was registered within
 *   AUTO_BIND_WINDOW_MS, bind its connectionId onto the session's row.
 * - tombstoneOpenCodeSession: exclude a session from all future snapshots.
 * - recordPendingConnection: track a just-registered MCP transport awaiting binding.
 */

import {
  getRegisteredConnectionBySessionId,
  isProviderSessionClaimed,
  updateConnectionId,
  upsertRegisteredConnection,
} from '../../database';
import { injectOpenCodeMessage } from '../../opencode/injector';
import { createLogger } from '../../utils/logger';
import {
  _pendingConnections,
  _sessionCache,
  _tombstonedSessionIds,
  state,
} from './state';
import { scheduleSnapshot } from './snapshot';
import { AUTO_BIND_WINDOW_MS, type SessionInfo } from './types';

const log = createLogger('session-tree');

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

// ─── Auto-bind logic ─────────────────────────────────────────────────────────

export function tryAutoBindSession(info: SessionInfo): void {
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

  // Phase 4: the SSE auto-register path has already created the row with
  // connection_id = NULL. Bind the waiting transport by setting connection_id
  // on the existing row (never by recreating it, and never by setting
  // connection_id = provider_session_id).
  updateConnectionId(info.id, bestConnId, 'opencode');
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

// ─── Auto-register ───────────────────────────────────────────────────────────

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
export function autoRegisterSession(
  info: SessionInfo,
  options?: { scheduleSnapshot?: boolean },
): void {
  // Only auto-register OpenCode sessions (providerType = 'opencode')
  const alreadyClaimed = isProviderSessionClaimed(info.id, 'opencode');
  const existing = alreadyClaimed
    ? getRegisteredConnectionBySessionId(info.id, 'opencode')
    : null;
  log.info(
    `autoRegisterSession: sessionId=${info.id}, parentID=${info.parentID ?? 'null'}, alreadyClaimed=${alreadyClaimed}, openCodeDirectory=${info.directory ?? '(none)'}, existingBaseDirectory=${existing?.baseDirectory ?? '(none)'}`,
  );

  if (alreadyClaimed) {
    log.info(`session ${info.id} already claimed — skipping auto-register`);
    return;
  }

  // Parent baseDirectory inheritance:
  // Task-tool-spawned subagents often report a fallback directory (the user's
  // HOME dir, or `/Users`) instead of the real project directory. If this
  // session has a parent AND the reported directory looks like a fallback,
  // inherit the parent's registered baseDirectory so repo-scoped features
  // (doc search, file autocomplete) work correctly.
  let effectiveBaseDirectory = info.directory;
  if (info.parentID) {
    const home = process.env['HOME'];
    const looksLikeFallback =
      !info.directory ||
      info.directory === home ||
      info.directory === '/Users' ||
      info.directory === '/home';
    if (looksLikeFallback) {
      const parentConn = getRegisteredConnectionBySessionId(
        info.parentID,
        'opencode',
      );
      if (parentConn?.baseDirectory) {
        log.info(
          `inheriting parent baseDirectory for session ${info.id}: parent=${info.parentID}, parentBaseDirectory=${parentConn.baseDirectory} (child reported=${info.directory ?? '(none)'})`,
        );
        effectiveBaseDirectory = parentConn.baseDirectory;
      }
    }
  }

  log.info(
    `upserting registered connection for session ${info.id} with baseDirectory=${effectiveBaseDirectory ?? '(none)'}`,
  );
  // Phase 4 invariant: SSE is the sole creator of OpenCode rows. Insert with
  // connection_id = NULL — the MCP transport id is bound later (either by
  // `autoRegisterDefaultConnection` in mcp-server.ts on MCP initialize, or by
  // `tryAutoBindSession` below when a pending transport was registered within
  // AUTO_BIND_WINDOW_MS). A non-null value here would violate the invariant
  // `connection_id != provider_session_id` for OpenCode rows.
  upsertRegisteredConnection({
    providerSessionId: info.id,
    providerType: 'opencode',
    connectionId: null,
    channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
    projectName: 'OpenCode',
    baseDirectory: effectiveBaseDirectory,
    parentSessionId: info.parentID ?? undefined,
  });
  log.info(`registered connection upserted for session ${info.id}`);

  // Inject session ID into child agent context so it knows what to pass to
  // register_connection. Root sessions are handled by mcp-server.ts via
  // autoDetectOpenCodeSession, so we only inject for child sessions here.
  if (info.parentID) {
    const port = state.getOpenCodePort?.() ?? 4096;
    log.info(
      `injecting session bootstrap message for child session ${info.id}, parentID=${info.parentID}`,
    );
    void injectOpenCodeMessage(
      info.id,
      buildSessionBootstrapMessage(info.id, info.parentID),
      undefined,
      port,
    );
  }

  if (options?.scheduleSnapshot !== false) {
    scheduleSnapshot();
    log.info(`scheduleSnapshot called for session ${info.id}`);
  }
}
