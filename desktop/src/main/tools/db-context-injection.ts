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

import type { BrowserWindow } from 'electron';
import {
  listSkillsAndInstructions,
  type SkillOrInstruction,
} from '../database';
import { startStartupContextInjection } from './register-connection-background';
import {
  buildStartupContextMessage,
  type StartupContextParams,
} from './startup-context';
import { createLogger } from '../utils/logger';

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

export interface MaybeInjectOptions {
  openCodeSessionId: string | undefined | null;
  channelName: string;
  projectName: string;
  baseDirectory?: string | null;
  connectionId: string;
  getWindow: () => BrowserWindow | null;
  getOpenCodePort: () => number;
  /** Override hooks for tests. */
  _listEntries?: () => SkillOrInstruction[];
  _buildMessage?: (p: StartupContextParams) => string;
  _startInjection?: typeof startStartupContextInjection;
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
  const build = options._buildMessage ?? buildStartupContextMessage;
  const start = options._startInjection ?? startStartupContextInjection;

  let enabled: SkillOrInstruction[];
  try {
    enabled = list().filter((e) => e.enabled);
  } catch (err) {
    log.warn(
      `failed to list DB skills/instructions for session ${options.openCodeSessionId ?? '(none)'}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const decision = decideShouldInjectDbContext({
    openCodeSessionId: options.openCodeSessionId,
    alreadyInjected: injectedSessionIds,
    enabledEntryCount: enabled.length,
  });

  if (!decision.shouldInject) {
    log.info(
      `skipping DB context injection for session ${options.openCodeSessionId ?? '(none)'}: ${decision.reason}`,
    );
    return;
  }

  const sessionId = options.openCodeSessionId as string;
  injectedSessionIds.add(sessionId);

  let message: string;
  try {
    message = build({
      channelName: options.channelName,
      projectName: options.projectName,
      baseDirectory: options.baseDirectory ?? undefined,
      openCodeSessionId: sessionId,
      entries: enabled,
    });
  } catch (err) {
    injectedSessionIds.delete(sessionId);
    log.warn(
      `failed to build startup-context message for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  log.info(
    `injecting DB context (${enabled.length} entries) into session ${sessionId} on auto-register`,
  );

  try {
    start({
      getWindow: options.getWindow,
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

/** Test-only: reset the dedupe set. */
export function _resetInjectedSessionsForTests(): void {
  injectedSessionIds.clear();
}

/** Test-only: peek at the dedupe set. */
export function _getInjectedSessionsForTests(): ReadonlySet<string> {
  return injectedSessionIds;
}
