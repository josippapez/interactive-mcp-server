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

  it('does not add skills/instructions section when entries is empty', () => {
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries: [],
    });
    expect(text).not.toContain('Available Skills');
    expect(text).not.toContain('Active Instructions');
  });

  // ── Change 1: skills show name + description only ──────────────────────────

  it('shows skill name and description only (not content) in the skills section', () => {
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

    expect(text).toContain('Available Skills:');
    expect(text).toContain('code-review: Step-by-step code review workflow');
    // Full content must NOT be inlined for skills
    expect(text).not.toContain('# Code Review');
    expect(text).not.toContain('Do this and that.');
  });

  // ── Change 1: instructions inject full content ─────────────────────────────

  it('includes full instruction content in the instructions section', () => {
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

    expect(text).toContain('Active Instructions:');
    expect(text).toContain('tdd: Test-Driven Development policy');
    // Full content MUST be present for instructions
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

  it('shows skills (name+desc only) and instructions (with full content) together', () => {
    const entries: SkillOrInstruction[] = [
      makeSkill('code-review', 'Code review workflow', '# Review\nContent'),
      makeInstruction('tdd', 'TDD policy', '# TDD\nWrite failing test first'),
    ];
    const text = buildStartupContextMessage({
      channelName: 'Agent',
      projectName: 'proj',
      entries,
    });

    // Skills: name + description present; content absent
    expect(text).toContain('Available Skills:');
    expect(text).toContain('code-review: Code review workflow');
    expect(text).not.toContain('# Review\nContent');

    // Instructions: name + description + full content all present
    expect(text).toContain('Active Instructions:');
    expect(text).toContain('tdd: TDD policy');
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
    // Instructions are fully injected — no "get" tool needed for instructions
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
    expect(text).not.toContain(
      'Pass this as openCodeSessionId when calling any interactive-desktop MCP tool.',
    );
  });

  it('places openCodeSessionId lines after project/channel info and before skills/instructions', () => {
    const text = buildStartupContextMessage({
      channelName: 'My Agent',
      projectName: 'my-proj',
      openCodeSessionId: 'ses_xyzabc',
      entries: [makeInstruction('tdd', 'TDD policy', '# TDD')],
    });

    const sessionIdIndex = text.indexOf('OpenCode session ID: ses_xyzabc');
    const projectIndex = text.indexOf('Project: my-proj');
    const instructionIndex = text.indexOf('Active Instructions:');

    expect(sessionIdIndex).toBeGreaterThan(projectIndex);
    expect(sessionIdIndex).toBeLessThan(instructionIndex);
  });
});
