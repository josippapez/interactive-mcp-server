/**
 * Pure logic for picking which OpenCode sessions should receive a
 * skills-changed `<system-reminder>` broadcast.
 *
 * Extracted as a pure function so the side-effectful injector loop in
 * `manage-skills-and-instructions.ts` can be tested without mocking the
 * OpenCode HTTP client.
 *
 * Selection rules:
 * - Only `providerType === 'opencode'` rows are candidates — other providers
 *   do not have an injection channel.
 * - Rows must have a non-empty `providerSessionId` (it's the injection target).
 * - Duplicates by `providerSessionId` are collapsed (subagents may share rows
 *   with a parent — we only inject once per session).
 */

import {
  getRegisteredConnectionsByProvider,
  type RegisteredConnection,
} from '../database';
import { injectOpenCodeMessage } from '../injector';
import { createLogger } from '../../../utils/logger';
import {
  buildSkillsChangedReminder,
  buildSessionScopeChangedReminder,
  type SkillsChangeAction,
  type SessionScopeChangedReminderParams,
} from '../startup-context';

const broadcastLog = createLogger('skills-broadcast');

export interface ReminderTarget {
  providerSessionId: string;
}

export function pickReminderTargets(
  connections: RegisteredConnection[],
): ReminderTarget[] {
  const seen = new Set<string>();
  const targets: ReminderTarget[] = [];
  for (const c of connections) {
    if (c.providerType !== 'opencode') continue;
    if (!c.providerSessionId) continue;
    if (seen.has(c.providerSessionId)) continue;
    seen.add(c.providerSessionId);
    targets.push({ providerSessionId: c.providerSessionId });
  }
  return targets;
}

/**
 * Fire-and-forget broadcast of a `<system-reminder>` to every active OpenCode
 * session. Errors are logged but never thrown — UI mutations must not be
 * blocked by injection failures.
 */
export async function broadcastSkillsChanged(
  action: SkillsChangeAction,
  type: 'skill' | 'instruction',
  name: string,
  port: number,
  deliveryMode?: 'always' | 'catalog',
): Promise<void> {
  try {
    const connections = await getRegisteredConnectionsByProvider('opencode');
    const targets = pickReminderTargets(connections);
    if (targets.length === 0) return;
    const reminder = buildSkillsChangedReminder({
      action,
      type,
      name,
      deliveryMode,
    });
    for (const target of targets) {
      void injectOpenCodeMessage(
        target.providerSessionId,
        reminder,
        undefined,
        port,
        undefined,
        true, // noReply
        undefined,
        undefined,
      ).catch((err: unknown) => {
        broadcastLog.warn(
          `failed to inject skills-changed reminder into session ${target.providerSessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  } catch (err) {
    broadcastLog.warn(
      `broadcastSkillsChanged failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Fire-and-forget broadcast of a session-scope-changed `<system-reminder>` to
 * a single OpenCode session. Used when the user toggles session-scoped opt-ins
 * in the inline composer selector.
 */
export function broadcastSessionScopeChanged(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  diff: SessionScopeChangedReminderParams,
  port: number,
): void {
  if (providerType !== 'opencode') return;
  if (!providerSessionId) return;
  if (diff.added.length === 0 && diff.removed.length === 0) return;
  try {
    const reminder = buildSessionScopeChangedReminder(diff);
    void injectOpenCodeMessage(
      providerSessionId,
      reminder,
      undefined,
      port,
      undefined,
      true, // noReply
      undefined,
      undefined,
    ).catch((err: unknown) => {
      broadcastLog.warn(
        `failed to inject session-scope-changed reminder into session ${providerSessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  } catch (err) {
    broadcastLog.warn(
      `broadcastSessionScopeChanged failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
