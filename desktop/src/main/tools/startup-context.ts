/**
 * Pure functions that build the `<system-reminder>` startup-context message
 * and the post-write skills/instructions change reminder.
 *
 * Extracted from `register-connection.ts` so they can be unit-tested without
 * needing the full tool registration machinery.
 *
 * Design rules:
 * - Skills: emitted in an `<available_skills source="db">` block with name +
 *   description only. Full content is on-demand via the
 *   `manage_skills_and_instructions get` tool — same on-demand pattern as
 *   file-based skills.
 * - Instructions: emitted in an `<instructions source="db">` block with full
 *   content inlined verbatim. Always-active policies that the agent must
 *   follow immediately without a separate tool call.
 * - The `<source>db</source>` / `source="db"` markers let agents distinguish
 *   DB-stored entries from file-based skills (which OpenCode injects with
 *   `<location>file://...</location>`).
 * - Empty XML blocks are NEVER emitted — sections are only included when they
 *   have content.
 */

import type { SkillOrInstruction } from '../database';

export interface StartupContextParams {
  channelName: string;
  projectName: string;
  baseDirectory?: string;
  openCodeSessionId?: string;
  entries: SkillOrInstruction[];
}

export function buildStartupContextMessage(
  params: StartupContextParams,
): string {
  const {
    channelName,
    projectName,
    baseDirectory,
    openCodeSessionId,
    entries,
  } = params;

  const locationLine = baseDirectory
    ? `- Base directory: ${baseDirectory}`
    : '- Base directory: not provided';

  const lines: string[] = [];

  lines.push('<system-reminder>');
  lines.push('Interactive MCP Desktop session bootstrap:');
  lines.push(`- Registered agent: ${channelName}`);
  lines.push(`- Project: ${projectName}`);
  lines.push(locationLine);

  if (openCodeSessionId) {
    lines.push(`- OpenCode session ID: ${openCodeSessionId}`);
    lines.push(
      '- Pass this as openCodeSessionId when calling any interactive-desktop MCP tool.',
    );
  }

  lines.push(
    '- Prompting policy: use interactive prompt tools for user questions.',
    '- Timeout policy: if a prompt times out or returns a timeout error (including -32001), re-prompt immediately.',
    '- Stop phrases (exact match): "Stop prompting", "End session", "Don\'t ask anymore", "Close conversation".',
    '- Parallel subagents should use unique agent names to avoid sidebar name collisions.',
  );

  // Filter to only enabled entries
  const enabled = entries.filter((e) => e.enabled);
  const skills = enabled.filter((e) => e.type === 'skill');
  const instructions = enabled.filter((e) => e.type === 'instruction');

  if (skills.length > 0) {
    lines.push('');
    lines.push('<available_skills source="db">');
    for (const skill of skills) {
      lines.push('  <skill>');
      lines.push(`    <name>${skill.name}</name>`);
      lines.push(`    <description>${skill.description}</description>`);
      lines.push('    <source>db</source>');
      lines.push('  </skill>');
    }
    lines.push('</available_skills>');
  }

  if (instructions.length > 0) {
    lines.push('');
    lines.push('<instructions source="db">');
    for (const instruction of instructions) {
      lines.push('  <instruction>');
      lines.push(`    <name>${instruction.name}</name>`);
      lines.push(`    <description>${instruction.description}</description>`);
      lines.push('    <content>');
      lines.push(instruction.content);
      lines.push('    </content>');
      lines.push('  </instruction>');
    }
    lines.push('</instructions>');
  }

  if (skills.length > 0) {
    lines.push('');
    lines.push(
      'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill by name.',
    );
  }

  lines.push('</system-reminder>');
  return lines.join('\n');
}

// ─── Post-write reminder ────────────────────────────────────────────────────

export type SkillsChangeAction = 'registered' | 'updated' | 'deleted';

export interface SkillsChangedReminderParams {
  action: SkillsChangeAction;
  type: 'skill' | 'instruction';
  name: string;
}

/**
 * Build a small `<system-reminder>` notice indicating that a DB-stored skill
 * or instruction was added/updated/deleted. Sent to all active sessions on
 * every write so agents know the available_skills/instructions context is
 * stale. The notice does NOT re-inject the full block — agents are pointed at
 * `manage_skills_and_instructions list` to fetch the latest list on demand.
 */
export function buildSkillsChangedReminder(
  params: SkillsChangedReminderParams,
): string {
  const { action, type, name } = params;
  return [
    '<system-reminder>',
    `A DB-stored ${type} was ${action}: ${name}.`,
    'The latest list is available via the manage_skills_and_instructions tool with action "list".',
    type === 'skill'
      ? 'Use action "get" with the skill name to fetch its full content on demand.'
      : 'Updated instruction content will be re-injected on the next session bootstrap.',
    '</system-reminder>',
  ].join('\n');
}
