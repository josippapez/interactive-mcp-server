/**
 * Auto-register logic for OpenCode sessions.
 *
 * autoRegisterSession creates a registered_connections row with
 * connection_id = NULL for any new OpenCode session so it appears in the
 * sidebar immediately. Tombstoning is handled by `session-tree-service`.
 *
 * NOTE (Phase 6 follow-up): the legacy `recordPendingConnection` /
 * `tryAutoBindSession` heuristic was removed. The post-Phase-6 agent contract
 * (root `AGENTS.md`) requires every tool call — including `register_connection`
 * — to pass `openCodeSessionId`, which means there is no longer any case where
 * we need to guess a connection→session binding from timestamps. Routing now
 * always uses the explicit session ID.
 */

import {
  getDbInstance,
  getRegisteredConnectionBySessionId,
  isProviderSessionClaimed,
  listSessionMutedEntryNames,
  listSessionScopedEntryNames,
  listSkillsAndInstructions,
  upsertRegisteredConnection,
} from './database';
import { injectOpenCodeMessage } from './injector';
import {
  markDbContextInjected,
  clearDbContextInjected,
} from './tools/db-context-injection';
import { buildStartupContextMessage } from './startup-context';
import { createLogger } from '../../utils/logger';
import { invalidateSessionTree } from './session-tree-service';
import type { SessionInfo } from './session-types';

const log = createLogger('session-auto-register');

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

export interface AutoRegisterSessionOptions {
  /** OpenCode HTTP port used for the bootstrap-message injection. */
  getOpenCodePort: () => number;
  /** Whether to invalidate the session tree after upserting. Default true. */
  invalidate?: boolean;
}

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
  options: AutoRegisterSessionOptions,
): void {
  // ── DB-only synchronous block ────────────────────────────────────────────
  // Wrap every DB read/write in a single better-sqlite3 transaction so the
  // WAL fsync amortises across all statements. SSE bursts during agent edits
  // used to fan out one fsync per statement which froze the main thread;
  // batching ~6+ statements per call into one txn cuts that cost an order of
  // magnitude.
  //
  // IMPORTANT: better-sqlite3 transactions MUST run synchronously inside.
  // No awaits, no setImmediate, no I/O. The HTTP `injectOpenCodeMessage`
  // calls are scheduled with setImmediate AFTER the transaction commits.
  interface TxnResult {
    skipped: boolean;
    effectiveBaseDirectory: string | undefined;
    skillsContext: {
      dbContext: string;
      effectiveCount: number;
      totalCount: number;
      sessionOptInCount: number;
      sessionMutedCount: number;
    } | null;
  }

  const db = getDbInstance();
  const runDbWork = (): TxnResult => {
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
      return {
        skipped: true,
        effectiveBaseDirectory: undefined,
        skillsContext: null,
      };
    }

    // Parent baseDirectory inheritance — see file-level docstring.
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

    // Build the skills/instructions context payload INSIDE the transaction
    // so all related reads ride the same WAL fsync. The actual HTTP delivery
    // happens after the txn commits via setImmediate.
    const skillsContext = buildDbSkillsContext({
      sessionId: info.id,
      sessionTitle: info.title ?? null,
      baseDirectory: effectiveBaseDirectory ?? null,
    });

    return {
      skipped: false,
      effectiveBaseDirectory,
      skillsContext,
    };
  };

  const result: TxnResult = db ? db.transaction(runDbWork)() : runDbWork();

  if (result.skipped) {
    return;
  }

  // ── Async / I/O work (after the txn commits) ─────────────────────────────
  // Schedule HTTP injections on setImmediate so the SSE event handler
  // returns immediately — the OpenCode HTTP work no longer blocks
  // subsequent SSE events.
  const port = options.getOpenCodePort();

  if (info.parentID) {
    log.info(
      `injecting session bootstrap message for child session ${info.id}, parentID=${info.parentID}`,
    );
    const parentId = info.parentID;
    setImmediate(() => {
      void injectOpenCodeMessage(
        info.id,
        buildSessionBootstrapMessage(info.id, parentId),
        undefined,
        port,
        undefined,
        true,
      );
    });
  }

  if (result.skillsContext) {
    const {
      dbContext,
      effectiveCount,
      totalCount,
      sessionOptInCount,
      sessionMutedCount,
    } = result.skillsContext;
    log.info(
      `injecting DB skills/instructions context (${effectiveCount} of ${totalCount} entries; ${sessionOptInCount} session opt-ins, ${sessionMutedCount} session mutes) into ${info.parentID ? 'child' : 'root'} session ${info.id} reason=session.created`,
    );
    setImmediate(() => {
      void injectOpenCodeMessage(
        info.id,
        dbContext,
        undefined,
        port,
        undefined,
        true,
      )
        .then(() => markDbContextInjected(info.id))
        .catch((err: unknown) => {
          log.warn(
            `failed to inject DB skills/instructions for session ${info.id} reason=session.created: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    });
  }

  if (options.invalidate !== false) {
    invalidateSessionTree();
  }
}

// ─── DB skills/instructions injection helper ─────────────────────────────────

interface BuildDbSkillsContextOptions {
  sessionId: string;
  sessionTitle: string | null;
  baseDirectory: string | null;
}

interface DbSkillsContext {
  dbContext: string;
  effectiveCount: number;
  totalCount: number;
  sessionOptInCount: number;
  sessionMutedCount: number;
}

/**
 * Synchronous DB-only step of the skills/instructions injection.
 *
 * Reads enabled entries + per-session opt-in / mute lists and assembles the
 * `<system-reminder>` body. Performs no network I/O — safe to call inside a
 * better-sqlite3 transaction.
 *
 * Returns null when there is nothing to inject for this session (no enabled
 * entries after filtering).
 */
function buildDbSkillsContext(
  options: BuildDbSkillsContextOptions,
): DbSkillsContext | null {
  const { sessionId, sessionTitle, baseDirectory } = options;
  try {
    const entries = listSkillsAndInstructions().filter((e) => e.enabled);
    const sessionOptInNames = listSessionScopedEntryNames(
      'opencode',
      sessionId,
    );
    const sessionMutedNames = listSessionMutedEntryNames('opencode', sessionId);
    const optInSet = new Set(sessionOptInNames);
    const mutedSet = new Set(sessionMutedNames);
    const effective = entries.filter(
      (e) =>
        (e.scope === 'global' && !mutedSet.has(e.name)) ||
        (e.scope === 'session-scoped' && optInSet.has(e.name)),
    );
    if (effective.length === 0) {
      return null;
    }
    const dbContext = buildStartupContextMessage({
      channelName: sessionTitle ?? `Session ${sessionId.slice(0, 8)}`,
      projectName: 'OpenCode',
      baseDirectory: baseDirectory ?? undefined,
      openCodeSessionId: sessionId,
      entries,
      sessionOptInNames,
      sessionMutedNames,
    });
    return {
      dbContext,
      effectiveCount: effective.length,
      totalCount: entries.length,
      sessionOptInCount: sessionOptInNames.length,
      sessionMutedCount: sessionMutedNames.length,
    };
  } catch (err) {
    log.warn(
      `failed to build DB skills/instructions context for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

interface InjectDbSkillsOptions {
  sessionId: string;
  sessionTitle: string | null;
  baseDirectory: string | null;
  parentSessionId: string | null;
  port: number;
  /**
   * Why this injection is happening — drives dedupe behavior.
   * - 'session.created' honours the per-process dedupe set.
   * - 'session.compacted' clears the dedupe flag first so the reminder
   *   is re-delivered after OpenCode rewrites the session history.
   */
  reason: 'session.created' | 'session.compacted';
}

/**
 * Build and inject the DB-stored skills/instructions `<system-reminder>` block
 * for a session.
 *
 * Delivered in the user-message BODY (arg 2) with `noReply: true`, NOT in the
 * `systemMessage` slot (arg 8). Per OpenCode's `session/llm.ts`, the per-call
 * `system` only persists while the injected row is `lastUser`, so a
 * `systemMessage` delivery would evaporate on the session's first real user
 * prompt. Body delivery persists in `messages[]` and is replayed every step
 * via `MessageV2.toModelMessages`.
 *
 * Compaction re-injection (`reason === 'session.compacted'`):
 *   OpenCode's auto-summarize/compaction rewrites the visible history with a
 *   summary, dropping previously-injected `<system-reminder>` blocks from
 *   the context window. We clear the per-process dedupe flag and re-inject
 *   so the agent continues to see the same standing rules after compaction.
 */
function injectDbSkillsAndInstructions(options: InjectDbSkillsOptions): void {
  const {
    sessionId,
    sessionTitle,
    baseDirectory,
    parentSessionId,
    port,
    reason,
  } = options;

  if (reason === 'session.compacted') {
    clearDbContextInjected(sessionId);
  }

  const ctx = buildDbSkillsContext({
    sessionId,
    sessionTitle,
    baseDirectory,
  });
  if (!ctx) return;

  log.info(
    `injecting DB skills/instructions context (${ctx.effectiveCount} of ${ctx.totalCount} entries; ${ctx.sessionOptInCount} session opt-ins, ${ctx.sessionMutedCount} session mutes) into ${parentSessionId ? 'child' : 'root'} session ${sessionId} reason=${reason}`,
  );
  void injectOpenCodeMessage(
    sessionId,
    ctx.dbContext,
    undefined,
    port,
    undefined,
    true,
  )
    .then(() => markDbContextInjected(sessionId))
    .catch((err: unknown) => {
      log.warn(
        `failed to inject DB skills/instructions for session ${sessionId} reason=${reason}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

// ─── Post-compaction re-injection entry point ────────────────────────────────

export interface ReinjectAfterCompactionOptions {
  /** OpenCode HTTP port used for the re-injection. */
  getOpenCodePort: () => number;
}

/**
 * Re-injects DB-stored skills/instructions after OpenCode compacts a session.
 *
 * OpenCode's auto-summarize rewrites the session's message history with a
 * condensed summary, which drops previously-injected `<system-reminder>`
 * blocks from the visible context window. Without re-injection, the agent
 * loses access to enabled skills/instructions after every compaction.
 *
 * This function is idempotent and safe to call repeatedly — it resolves the
 * current DB row for the session, clears the dedupe flag, and re-runs the
 * same injection as `autoRegisterSession`.
 */
export function reinjectDbContextAfterCompaction(
  sessionId: string,
  options: ReinjectAfterCompactionOptions,
): void {
  if (!sessionId) return;

  const existing = getRegisteredConnectionBySessionId(sessionId, 'opencode');
  if (!existing) {
    log.info(
      `reinjectDbContextAfterCompaction: no registered connection for session ${sessionId} — skipping`,
    );
    return;
  }

  log.info(`reinjecting DB context after compaction for session ${sessionId}`);
  injectDbSkillsAndInstructions({
    sessionId,
    sessionTitle: existing.channelName ?? null,
    baseDirectory: existing.baseDirectory ?? null,
    parentSessionId: existing.parentSessionId ?? null,
    port: options.getOpenCodePort(),
    reason: 'session.compacted',
  });
}
