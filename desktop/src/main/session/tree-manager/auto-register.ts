/**
 * Auto-register and auto-bind logic for OpenCode sessions.
 *
 * - autoRegisterSession: create a registered_connections row with connection_id=NULL
 *   for any new OpenCode session, so it appears in the sidebar immediately.
 * - tombstoneOpenCodeSession: exclude a session from all future snapshots.
 *
 * NOTE (Phase 6 follow-up): the legacy `recordPendingConnection` /
 * `tryAutoBindSession` heuristic was removed. The post-Phase-6 agent contract
 * (root `AGENTS.md`) requires every tool call — including `register_connection`
 * — to pass `openCodeSessionId`, which means there is no longer any case where
 * we need to guess a connection→session binding from timestamps. Routing now
 * always uses the explicit session ID. Removing the heuristic also removes a
 * mis-binding (data corruption) race when two subagents registered without
 * `openCodeSessionId` within `AUTO_BIND_WINDOW_MS`.
 */

import {
  getRegisteredConnectionBySessionId,
  isProviderSessionClaimed,
  listSkillsAndInstructions,
  upsertRegisteredConnection,
} from '../../database';
import { injectOpenCodeMessage } from '../../opencode/injector';
import { buildStartupContextMessage } from '../../tools/startup-context';
import { createLogger } from '../../utils/logger';
import { _sessionCache, _tombstonedSessionIds, state } from './state';
import { scheduleSnapshot } from './snapshot';
import { type SessionInfo } from './types';

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
  log.info(
    `[bug2-trace] auto-register-sse providerSessionId=${info.id} ` +
      `connectionId=null parentSessionId=${info.parentID ?? 'null'} ` +
      `ts=${Date.now()}`,
  );
  // Phase 4 invariant: SSE is the sole creator of OpenCode rows. Insert with
  // connection_id = NULL — the MCP transport id is bound later by
  // `autoRegisterDefaultConnection` in mcp-server.ts on MCP initialize, or by
  // an explicit `register_connection` call from the agent (which always passes
  // `openCodeSessionId` per the post-Phase-6 contract). A non-null value here
  // would violate the invariant `connection_id != provider_session_id` for
  // OpenCode rows.
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

    // Also inject DB-stored skills and instructions so child agents have the
    // same knowledge context as parent (whose context comes from
    // register_connection). Skip the network call entirely when there are
    // no enabled entries to avoid an empty system-message injection.
    try {
      const entries = listSkillsAndInstructions().filter((e) => e.enabled);
      if (entries.length > 0) {
        const dbContext = buildStartupContextMessage({
          channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
          projectName: 'OpenCode',
          baseDirectory: effectiveBaseDirectory,
          openCodeSessionId: info.id,
          entries,
        });
        log.info(
          `injecting DB skills/instructions context (${entries.length} entries) into child session ${info.id}`,
        );
        void injectOpenCodeMessage(
          info.id,
          '', // empty user message — content goes in systemMessage
          undefined,
          port,
          undefined,
          true, // noReply
          undefined,
          dbContext,
        );
      }
    } catch (err) {
      log.warn(
        `failed to inject DB skills/instructions for child session ${info.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (options?.scheduleSnapshot !== false) {
    scheduleSnapshot();
    log.info(`scheduleSnapshot called for session ${info.id}`);
  }
}
