/**
 * Re-injects DB-stored skills/instructions into an OpenCode session whenever
 * the MCP transport (re)connects to a known session.
 *
 * Background:
 *   `register_connection` builds a startup-context message containing all
 *   enabled DB skills/instructions and injects it via `startStartupContextInjection`.
 *   But many agents never call `register_connection` (it is optional), and
 *   even when they do, an OpenCode session **resume** loses the previously
 *   injected system reminder — OpenCode rebuilds the system prompt every step
 *   from skills/env/instructions and does NOT replay MCP `system` injections
 *   across resumed steps.
 *
 *   This helper closes that gap by injecting the same startup context
 *   automatically whenever `autoRegisterDefaultConnection` binds the MCP
 *   transport to an existing OpenCode session row (the resume path) OR creates
 *   a fresh row for a detected session (the first-connect path that never
 *   went through `register_connection`).
 *
 * De-duplication:
 *   A per-process `Set<openCodeSessionId>` prevents re-injection on every MCP
 *   transport reconnect within the same desktop-app lifetime. The set is
 *   cleared on app restart, which is correct: after restart, the in-memory
 *   "we already injected this" knowledge is gone, but so is the agent's
 *   awareness of the previously injected reminder, so re-injection on the
 *   next connect is the desired behavior.
 *
 * Pure helpers in this module are unit-tested in `db-context-injection.test.ts`.
 */

import {
  listSkillsAndInstructions,
  listSessionScopedEntryNames,
  listSessionMutedEntryNames,
  listMemories,
  type Memory,
  type SkillOrInstruction,
} from '../database';
import { startStartupContextInjection } from './register-connection-background';
import {
  buildStartupContextMessage,
  type StartupContextParams,
} from '../startup-context';
import { createLogger } from '../../../utils/logger';

const log = createLogger('db-context-injection');

const injectedSessionIds = new Set<string>();

export interface MaybeInjectDecision {
  /** Should we inject DB context for this session right now? */
  shouldInject: boolean;
  /** Reason — for logging/debugging only. */
  reason:
    | 'no-session-id'
    | 'already-injected-this-process'
    | 'no-enabled-entries'
    | 'inject';
}

export interface MaybeInjectOptions {
  openCodeSessionId: string | undefined | null;
  channelName: string;
  projectName: string;
  baseDirectory?: string | null;
  connectionId: string;
  getOpenCodePort: () => number;
  /** Override hooks for tests. */
  _listEntries?: () => SkillOrInstruction[] | Promise<SkillOrInstruction[]>;
  _listSessionOptIns?: (
    providerType: string,
    providerSessionId: string,
  ) => string[] | Promise<string[]>;
  _listSessionMutes?: (
    providerType: string,
    providerSessionId: string,
  ) => string[] | Promise<string[]>;
  _buildMessage?: (p: StartupContextParams) => string;
  _startInjection?: typeof startStartupContextInjection;
}

/**
 * Pure decision: given the inputs, should we inject DB context?
 * Exported for unit testing.
 */
export function decideShouldInjectDbContext(params: {
  openCodeSessionId: string | undefined | null;
  alreadyInjected: ReadonlySet<string>;
  enabledEntryCount: number;
}): MaybeInjectDecision {
  const { openCodeSessionId, alreadyInjected, enabledEntryCount } = params;
  if (!openCodeSessionId) {
    return { shouldInject: false, reason: 'no-session-id' };
  }
  if (alreadyInjected.has(openCodeSessionId)) {
    return { shouldInject: false, reason: 'already-injected-this-process' };
  }
  if (enabledEntryCount === 0) {
    return { shouldInject: false, reason: 'no-enabled-entries' };
  }
  return { shouldInject: true, reason: 'inject' };
}

/**
 * Side-effectful entrypoint used from `mcp-server/auto-register.ts`.
 * Loads enabled DB entries, builds the startup-context message, and fires
 * the existing `startStartupContextInjection` background task. No-ops when
 * `decideShouldInjectDbContext` says so.
 */
export function maybeInjectDbContextOnConnect(
  options: MaybeInjectOptions,
): void {
  const list = options._listEntries ?? listSkillsAndInstructions;
  const listOptIns = options._listSessionOptIns ?? listSessionScopedEntryNames;
  const listMutes = options._listSessionMutes ?? listSessionMutedEntryNames;
  const build = options._buildMessage ?? buildStartupContextMessage;
  const start = options._startInjection ?? startStartupContextInjection;

  let enabled: SkillOrInstruction[];
  try {
    const result = list();
    const arr = Array.isArray(result) ? result : [];
    enabled = arr.filter((e: SkillOrInstruction) => e.enabled);
  } catch (err) {
    log.warn(
      `failed to list DB skills/instructions for session ${options.openCodeSessionId ?? '(none)'}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Resolve session-scoped opt-ins and session-muted globals.
  // - Global-scope entries are injected unless muted for this session.
  // - Session-scoped entries are only injected if the session opted in.
  let sessionOptInNames: string[] = [];
  let sessionMutedNames: string[] = [];
  if (options.openCodeSessionId) {
    try {
      const r = listOptIns('opencode', options.openCodeSessionId);
      sessionOptInNames = Array.isArray(r) ? r : [];
    } catch (err) {
      log.warn(
        `failed to list session-scoped opt-ins for session ${options.openCodeSessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const r = listMutes('opencode', options.openCodeSessionId);
      sessionMutedNames = Array.isArray(r) ? r : [];
    } catch (err) {
      log.warn(
        `failed to list session-muted globals for session ${options.openCodeSessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const optInSet = new Set(sessionOptInNames);
  const mutedSet = new Set(sessionMutedNames);
  const effective = enabled.filter(
    (e) =>
      (e.scope === 'global' && !mutedSet.has(e.name)) ||
      (e.scope === 'session-scoped' && optInSet.has(e.name)),
  );

  const decision = decideShouldInjectDbContext({
    openCodeSessionId: options.openCodeSessionId,
    alreadyInjected: injectedSessionIds,
    enabledEntryCount: effective.length,
  });

  if (!decision.shouldInject) {
    log.info(
      `skipping DB context injection for session ${options.openCodeSessionId ?? '(none)'}: ${decision.reason}`,
    );
    return;
  }

  const sessionId = options.openCodeSessionId as string;
  injectedSessionIds.add(sessionId);

  log.info(
    `injecting DB context (${effective.length} of ${enabled.length} entries; ${sessionOptInNames.length} opt-ins, ${sessionMutedNames.length} mutes) into session ${sessionId} on auto-register`,
  );

  let memories: Memory[] = [];
  try {
    const r = listMemories(
      options.baseDirectory
        ? { projectPath: options.baseDirectory }
        : { scope: 'global' },
    );
    memories = Array.isArray(r) ? r : [];
  } catch (err) {
    log.warn(
      `failed to list memories for session ${options.openCodeSessionId ?? '(none)'}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let message: string;
  try {
    message = build({
      channelName: options.channelName,
      projectName: options.projectName,
      baseDirectory: options.baseDirectory ?? undefined,
      openCodeSessionId: sessionId,
      entries: enabled,
      sessionOptInNames,
      sessionMutedNames,
      memories,
    });
  } catch (err) {
    injectedSessionIds.delete(sessionId);
    log.warn(
      `failed to build startup-context message for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  try {
    start({
      connectionId: options.connectionId,
      openCodeSessionId: sessionId,
      startupContextMessage: message,
      getOpenCodePort: options.getOpenCodePort,
      backendName: 'opencode',
      runtime: undefined,
      supportsProviderInjection: true,
    });
  } catch (err) {
    injectedSessionIds.delete(sessionId);
    log.warn(
      `failed to start DB context injection for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Mark a session as having received DB context injection. Used by callers
 * that perform their own injection (e.g. the SSE tree-manager auto-register
 * path) to participate in the shared per-process dedupe set and prevent
 * `maybeInjectDbContextOnConnect` from injecting again when the MCP transport
 * later binds to the same session.
 */
export function markDbContextInjected(openCodeSessionId: string): void {
  if (!openCodeSessionId) {
    return;
  }
  injectedSessionIds.add(openCodeSessionId);
}

/**
 * Clear the dedupe flag for a session so a subsequent call to
 * `maybeInjectDbContextOnConnect` or the SSE-path re-injection helper will
 * re-inject the startup context. Used after OpenCode compaction
 * (`session.compacted`), which rewrites the session's history and drops
 * previously-injected `<system-reminder>` blocks from the visible context
 * window.
 */
export function clearDbContextInjected(openCodeSessionId: string): void {
  if (!openCodeSessionId) {
    return;
  }
  injectedSessionIds.delete(openCodeSessionId);
}

/**
 * Predicate: has this session already received a DB context injection in the
 * current desktop process? Used by callers that want to skip their own
 * injection path when another path already handled it (prevents duplicate
 * `<system-reminder>` blocks from appearing in the OpenCode conversation).
 */
export function isDbContextInjected(openCodeSessionId: string): boolean {
  if (!openCodeSessionId) {
    return false;
  }
  return injectedSessionIds.has(openCodeSessionId);
}

/** Test-only: reset the dedupe set. */
export function _resetInjectedSessionsForTests(): void {
  injectedSessionIds.clear();
}

/** Test-only: peek at the dedupe set. */
export function _getInjectedSessionsForTests(): ReadonlySet<string> {
  return injectedSessionIds;
}
