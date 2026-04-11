/**
 * Pure function that builds the `<system-reminder>` startup context message
 * injected into agent sessions at `register_connection` time.
 *
 * Extracted from `register-connection.ts` so it can be unit-tested without
 * needing the full tool registration machinery.
 *
 * Design rules:
 * - Skills: show name + description only (on-demand loaded via the skill tool).
 * - Instructions: show name, description, AND full content (always-active
 *   policies that the agent must follow immediately without a separate tool call).
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

  // Build the output lines as a single system-reminder block.
  // The openCodeSessionId is included once in the bootstrap section when available.
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

  // Filter to only include enabled entries for injection
  const enabledEntries = entries.filter((e) => e.enabled);

  if (enabledEntries.length > 0) {
    const skills = enabledEntries.filter((e) => e.type === 'skill');
    const instructions = enabledEntries.filter((e) => e.type === 'instruction');

    if (skills.length > 0) {
      lines.push('');
      lines.push('Available Skills:');
      for (const skill of skills) {
        lines.push(`- ${skill.name}: ${skill.description}`);
      }
    }

    if (instructions.length > 0) {
      lines.push('');
      lines.push('Active Instructions:');
      for (const instruction of instructions) {
        // Include name, description, AND full content for instructions.
        // Instructions are always-active policies — agents must see the full
        // content immediately without a separate tool call.
        lines.push(`- ${instruction.name}: ${instruction.description}`);
        lines.push('');
        lines.push(instruction.content);
        lines.push('');
      }
    }

    if (skills.length > 0) {
      lines.push(
        'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill or instruction by name.',
      );
    }
  }

  lines.push('</system-reminder>');
  return lines.join('\n');
}
