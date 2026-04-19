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

import type { RegisteredConnection } from '../database';

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
