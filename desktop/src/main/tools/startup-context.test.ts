import { describe, it, expect } from 'vitest';
import { buildStartupContextMessage } from './startup-context';
import type { SkillOrInstruction } from '../database';

function makeSkill(
  name: string,
  description: string,
  content: string,
): SkillOrInstruction {
  return {
    id: 1,
    name,
    type: 'skill',
    description,
    content,
    category: null,
    tags: null,
    enabled: true,
    isBuiltin: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

function makeInstruction(
  name: string,
  description: string,
  content: string,
): SkillOrInstruction {
  return {
    id: 2,
    name,
    type: 'instruction',
    description,
    content,
    category: null,
    tags: null,
    enabled: true,
    isBuiltin: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

describe('buildStartupContextMessage', () => {
  it('produces a system-reminder block', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent A',
      projectName: 'my-project',
      entries: [],
    });
    expect(text).toContain('<system-reminder>');
    expect(text).toContain('</system-reminder>');
  });

  it('includes the channel name and project name', () => {
    const text = buildStartupContextMessage({
      channelName: 'Research Agent',
      projectName: 'acme-corp',
      entries: [],
    });
    expect(text).toContain('Research Agent');
    expect(text).toContain('acme-corp');
  });

  it('includes "not provided" when no baseDirectory is given', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [],
    });
    expect(text).toContain('Base directory: not provided');
  });

  it('includes the baseDirectory when provided', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: '/Users/me/projects/my-repo',
      entries: [],
    });
    expect(text).toContain('/Users/me/projects/my-repo');
  });

  it('does not add skills/instructions XML blocks when entries is empty', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [],
    });
    expect(text).not.toContain('<available_skills');
    expect(text).not.toContain('<instructions');
  });

  it('does not emit empty <available_skills> block when no skills exist (only instructions)', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [makeInstruction('rule', 'A rule', 'Follow this')],
    });
    expect(text).not.toContain('<available_skills');
  });

  it('does not emit empty <instructions> block when no instructions exist (only skills)', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [makeSkill('s', 'd', 'c')],
    });
    expect(text).not.toContain('<instructions source="db"');
  });

  it('skips disabled entries entirely', () => {
    const disabledSkill: SkillOrInstruction = {
      ...makeSkill('hidden', 'should not appear', 'x'),
      enabled: false,
    };
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [disabledSkill],
    });
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('<available_skills');
  });

  // ── XML format: skills ─────────────────────────────────────────────────────

  it('emits <available_skills source="db"> with <skill> entries (name + description + source=db)', () => {
    const skill = makeSkill(
      'code-review',
      'Step-by-step code review workflow',
      '# Code Review\n\nDo this and that.',
    );
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [skill],
    });

    expect(text).toContain('<available_skills source="db">');
    expect(text).toContain('</available_skills>');
    expect(text).toContain('<skill>');
    expect(text).toContain('<name>code-review</name>');
    expect(text).toContain(
      '<description>Step-by-step code review workflow</description>',
    );
    expect(text).toContain('<source>db</source>');
    // Full content must NOT be inlined for skills
    expect(text).not.toContain('# Code Review');
    expect(text).not.toContain('Do this and that.');
  });

  it('emits multiple <skill> children when multiple skills exist', () => {
    const skills = [
      makeSkill('a', 'desc a', 'content a'),
      makeSkill('b', 'desc b', 'content b'),
    ];
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: skills,
    });
    expect(text).toContain('<name>a</name>');
    expect(text).toContain('<name>b</name>');
    expect(text).toContain('<description>desc a</description>');
    expect(text).toContain('<description>desc b</description>');
  });

  // ── XML format: instructions ───────────────────────────────────────────────

  it('emits <instructions source="db"> with <instruction> entries containing full content', () => {
    const instruction = makeInstruction(
      'tdd',
      'Test-Driven Development policy',
      '# TDD\n\nWrite a failing test first.',
    );
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [instruction],
    });

    expect(text).toContain('<instructions source="db">');
    expect(text).toContain('</instructions>');
    expect(text).toContain('<instruction>');
    expect(text).toContain('<name>tdd</name>');
    expect(text).toContain(
      '<description>Test-Driven Development policy</description>',
    );
    // Full content MUST be present for instructions, wrapped in <content>
    expect(text).toContain('<content>');
    expect(text).toContain('</content>');
    expect(text).toContain('# TDD');
    expect(text).toContain('Write a failing test first.');
  });

  it('includes content for every instruction when multiple exist', () => {
    const instructions = [
      makeInstruction('tdd', 'TDD policy', '# TDD content here'),
      makeInstruction(
        'coding-standards',
        'Coding standards',
        '## Standards\n- No any types',
      ),
    ];
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: instructions,
    });

    expect(text).toContain('# TDD content here');
    expect(text).toContain('## Standards');
    expect(text).toContain('- No any types');
  });

  it('shows skills (in <available_skills>) and instructions (in <instructions>) together', () => {
    const entries: SkillOrInstruction[] = [
      makeSkill('code-review', 'Code review workflow', '# Review\nContent'),
      makeInstruction('tdd', 'TDD policy', '# TDD\nWrite failing test first'),
    ];
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries,
    });

    // Skills block
    expect(text).toContain('<available_skills source="db">');
    expect(text).toContain('<name>code-review</name>');
    expect(text).not.toContain('# Review\nContent');

    // Instructions block
    expect(text).toContain('<instructions source="db">');
    expect(text).toContain('<name>tdd</name>');
    expect(text).toContain('# TDD');
    expect(text).toContain('Write failing test first');
  });

  it('includes the manage_skills_and_instructions hint when skills are present', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [makeSkill('my-skill', 'desc', 'content')],
    });
    expect(text).toContain('manage_skills_and_instructions');
  });

  it('does NOT include the manage hint when only instructions are present (no skills)', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [makeInstruction('rule', 'A rule', 'Follow this rule always.')],
    });
    expect(text).not.toContain('manage_skills_and_instructions');
  });

  // ── openCodeSessionId injection ────────────────────────────────────────────

  it('includes openCodeSessionId line when openCodeSessionId is provided', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      openCodeSessionId: 'ses_abc123xyz',
      entries: [],
    });
    expect(text).toContain('OpenCode session ID: ses_abc123xyz');
    expect(text).toContain(
      'Pass this as openCodeSessionId when calling any interactive-desktop MCP tool.',
    );
  });

  it('does NOT include openCodeSessionId line when openCodeSessionId is undefined', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [],
    });
    expect(text).not.toContain('OpenCode session ID:');
  });

  it('places openCodeSessionId line after project info and before XML blocks', () => {
    const text = buildStartupContextMessage({
      channelName: 'My Agent',
      projectName: 'my-proj',
      openCodeSessionId: 'ses_xyzabc',
      entries: [makeInstruction('tdd', 'TDD policy', '# TDD')],
    });

    const sessionIdIndex = text.indexOf('OpenCode session ID: ses_xyzabc');
    const projectIndex = text.indexOf('Project: my-proj');
    const instructionIndex = text.indexOf('<instructions source="db">');

    expect(sessionIdIndex).toBeGreaterThan(projectIndex);
    expect(sessionIdIndex).toBeLessThan(instructionIndex);
  });
});

// ── Post-write reminder builder ────────────────────────────────────────────

import { buildSkillsChangedReminder } from './startup-context';

describe('buildSkillsChangedReminder', () => {
  it('emits a <system-reminder> block', () => {
    const text = buildSkillsChangedReminder({
      action: 'registered',
      type: 'skill',
      name: 'code-review',
    });
    expect(text).toContain('<system-reminder>');
    expect(text).toContain('</system-reminder>');
  });

  it('mentions the action, type, and name', () => {
    const text = buildSkillsChangedReminder({
      action: 'registered',
      type: 'skill',
      name: 'code-review',
    });
    expect(text).toContain('registered');
    expect(text).toContain('skill');
    expect(text).toContain('code-review');
  });

  it('handles the deleted action', () => {
    const text = buildSkillsChangedReminder({
      action: 'deleted',
      type: 'instruction',
      name: 'old-rule',
    });
    expect(text).toContain('deleted');
    expect(text).toContain('instruction');
    expect(text).toContain('old-rule');
  });

  it('points the agent at manage_skills_and_instructions list for the latest list', () => {
    const text = buildSkillsChangedReminder({
      action: 'updated',
      type: 'skill',
      name: 'foo',
    });
    expect(text).toContain('manage_skills_and_instructions');
    expect(text).toContain('list');
  });

  it('does NOT inline the skill content (agents must fetch on demand)', () => {
    const text = buildSkillsChangedReminder({
      action: 'registered',
      type: 'skill',
      name: 'big-skill',
    });
    // The reminder is a small notice, not a full re-injection
    expect(text.length).toBeLessThan(500);
  });
});
