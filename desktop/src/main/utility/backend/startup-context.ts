/**
 * Pure functions that build the `<system-reminder>` startup-context message
 * and the post-write skills/instructions change reminder.
 *
 * Extracted from `register-connection.ts` so they can be unit-tested without
 * needing the full tool registration machinery.
 *
 * Design rules:
 * - Skills: emitted in an `<available_skills source="db">` block with name +
 *   description only. Full content is on-demand via the exposed
 *   `manage_skills_and_instructions get` tool — same on-demand pattern as
 *   file-based skills.
 * - Instructions in `always` mode: emitted in an `<instructions source="db">`
 *   block with full content XML-escaped inline.
 * - Instructions in `catalog` mode: emitted in an
 *   `<available_instructions source="db">` block with name + description
 *   only. Full content stays on-demand via the same management tool.
 * - The `<source>db</source>` / `source="db"` markers let agents distinguish
 *   DB-stored entries from file-based skills (which OpenCode injects with
 *   `<location>file://...</location>`).
 * - Empty XML blocks are NEVER emitted — sections are only included when they
 *   have content.
 */

import type { Memory, SkillOrInstruction } from './database';

const SKILL_GET_NOTE =
  'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill by name.';
const CATALOG_INSTRUCTION_GET_NOTE =
  'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any catalog instruction by name.';

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface StartupContextParams {
  channelName: string;
  projectName: string;
  baseDirectory?: string;
  openCodeSessionId?: string;
  entries: SkillOrInstruction[];
  /**
   * Names of session-scoped entries the current session has opted into.
   * Entries with `scope === 'session-scoped'` are only included if their name
   * appears here. Entries with `scope === 'global'` are always included (when
   * enabled). Defaults to empty (no session-scoped entries injected).
   */
  sessionOptInNames?: readonly string[];
  /**
   * Names of global entries the current session has muted. Entries with
   * `scope === 'global'` whose name appears here are excluded from this
   * session's injection. Defaults to empty (no globals muted).
   */
  sessionMutedNames?: readonly string[];
  /**
   * Persistent memories to inject. Callers are responsible for filtering to
   * the right scope+project for the session (typically via
   * `listMemories({ projectPath: baseDirectory })`). Defaults to empty.
   */
  memories?: readonly Memory[];
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
    sessionOptInNames,
    sessionMutedNames,
    memories,
  } = params;
  const optIn = new Set(sessionOptInNames ?? []);
  const muted = new Set(sessionMutedNames ?? []);

  const locationLine = baseDirectory
    ? `- Base directory: ${escapeXmlText(baseDirectory)}`
    : '- Base directory: not provided';

  const lines: string[] = [];

  lines.push('<system-reminder>');
  lines.push('Interactive MCP Desktop session bootstrap:');
  lines.push(`- Registered agent: ${escapeXmlText(channelName)}`);
  lines.push(`- Project: ${escapeXmlText(projectName)}`);
  lines.push(locationLine);

  if (openCodeSessionId) {
    lines.push(`- OpenCode session ID: ${escapeXmlText(openCodeSessionId)}`);
    lines.push(
      '- Pass this as openCodeSessionId when calling repo docs/libs tools that include that parameter.',
    );
  }

  lines.push(
    '- Registration: this session was auto-registered by the desktop app from OpenCode SDK session events; do not call register_connection.',
    '- Exposed MCP tools: find_docs, find_repo_docs, list_docs, read_doc, find_libs, manage_skills_and_instructions, manage_memories, manage_background_subagents, message_background_subagent.',
    '- Interactive prompt/channel tools are not exposed by this MCP surface; use your harness-native user interaction tools when you need to ask the user.',
  );

  // Filter to only enabled entries that are either:
  // - scope='global' AND not muted for this session, OR
  // - scope='session-scoped' AND explicitly opted into for this session.
  const enabled = entries.filter(
    (e) =>
      e.enabled &&
      ((e.scope === 'global' && !muted.has(e.name)) ||
        (e.scope === 'session-scoped' && optIn.has(e.name))),
  );
  const skills = enabled.filter((e) => e.type === 'skill');
  const alwaysInstructions = enabled.filter(
    (e) => e.type === 'instruction' && e.deliveryMode !== 'catalog',
  );
  const catalogInstructions = enabled.filter(
    (e) => e.type === 'instruction' && e.deliveryMode === 'catalog',
  );

  if (skills.length > 0) {
    lines.push('');
    lines.push('<available_skills source="db">');
    for (const skill of skills) {
      lines.push('  <skill>');
      lines.push(`    <name>${escapeXmlText(skill.name)}</name>`);
      lines.push(
        `    <description>${escapeXmlText(skill.description)}</description>`,
      );
      lines.push('    <source>db</source>');
      lines.push('  </skill>');
    }
    lines.push('</available_skills>');
  }

  if (catalogInstructions.length > 0) {
    lines.push('');
    lines.push('<available_instructions source="db">');
    for (const instruction of catalogInstructions) {
      lines.push('  <instruction>');
      lines.push(`    <name>${escapeXmlText(instruction.name)}</name>`);
      lines.push(
        `    <description>${escapeXmlText(instruction.description)}</description>`,
      );
      lines.push('    <source>db</source>');
      lines.push('  </instruction>');
    }
    lines.push('</available_instructions>');
  }

  if (alwaysInstructions.length > 0) {
    lines.push('');
    lines.push('<instructions source="db">');
    for (const instruction of alwaysInstructions) {
      lines.push('  <instruction>');
      lines.push(`    <name>${escapeXmlText(instruction.name)}</name>`);
      lines.push(
        `    <description>${escapeXmlText(instruction.description)}</description>`,
      );
      lines.push('    <content>');
      lines.push(escapeXmlText(instruction.content));
      lines.push('    </content>');
      lines.push('  </instruction>');
    }
    lines.push('</instructions>');
  }

  const memoriesList = memories ?? [];
  if (memoriesList.length > 0) {
    lines.push('');
    lines.push('<memories source="db">');
    for (const memory of memoriesList) {
      const scopeAttr =
        memory.scope === 'project' && memory.projectPath
          ? ` project="${escapeXmlText(memory.projectPath)}"`
          : '';
      lines.push(`  <memory scope="${memory.scope}"${scopeAttr}>`);
      lines.push(escapeXmlText(memory.content));
      lines.push('  </memory>');
    }
    lines.push('</memories>');
  }

  if (skills.length > 0) {
    lines.push('');
    lines.push(SKILL_GET_NOTE);
  }

  if (catalogInstructions.length > 0) {
    lines.push('');
    lines.push(CATALOG_INSTRUCTION_GET_NOTE);
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
  deliveryMode?: 'always' | 'catalog';
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
  const { action, type, name, deliveryMode } = params;
  const isCatalogEntry = type === 'skill' || deliveryMode === 'catalog';
  return [
    '<system-reminder>',
    `A DB-stored ${type} was ${action}: ${escapeXmlText(name)}.`,
    'The latest list is available via the manage_skills_and_instructions tool with action "list".',
    isCatalogEntry
      ? `Use action "get" with the ${type} name to fetch its full content on demand.`
      : 'Updated always-mode instruction content will be applied to new bootstrap injections. Active sessions should refresh their reminder context if needed.',
    '</system-reminder>',
  ].join('\n');
}

// ─── Session-scope change reminder ──────────────────────────────────────────

export interface SessionScopeChangedReminderParams {
  /** Entry names newly added to this session's opt-in set. */
  added: readonly { name: string; type: 'skill' | 'instruction' }[];
  /** Entry names removed from this session's opt-in set. */
  removed: readonly { name: string; type: 'skill' | 'instruction' }[];
}

/**
 * Build a `<system-reminder>` notice describing the diff between the previous
 * and current session-scoped opt-in selection. Sent only to the affected
 * session when the user toggles entries in the inline composer selector.
 *
 * The reminder does NOT re-inject full content — it points agents at
 * `manage_skills_and_instructions list` / `get` for on-demand retrieval, the
 * same pattern as `buildSkillsChangedReminder`.
 */
export function buildSessionScopeChangedReminder(
  params: SessionScopeChangedReminderParams,
): string {
  const { added, removed } = params;
  const lines: string[] = ['<system-reminder>'];
  lines.push(
    'Session-scoped skills/instructions selection changed for this session.',
  );

  if (added.length > 0) {
    lines.push('Added (now active for this session):');
    for (const e of added) {
      lines.push(`- ${e.type}: ${escapeXmlText(e.name)}`);
    }
  }

  if (removed.length > 0) {
    lines.push('Removed (no longer active for this session):');
    for (const e of removed) {
      lines.push(`- ${e.type}: ${escapeXmlText(e.name)}`);
    }
  }

  lines.push(
    'The full current list is available via the manage_skills_and_instructions tool with action "list".',
    'Use action "get" with a skill name to fetch its full content on demand.',
    '</system-reminder>',
  );
  return lines.join('\n');
}
