import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../../../../preload';
import { filterAgents, groupAgentsByScope } from './agent-picker-filter';

const AGENTS: AgentDefinition[] = [
  {
    name: 'reviewer',
    filePath: '/project/.opencode/agent/reviewer.md',
    scope: 'project',
    baseDirectory: '/project',
    description: 'Reviews pull requests carefully',
    mode: 'subagent',
    tools: {},
    body: '',
    rawContents: '',
  },
  {
    name: 'planner',
    filePath: '/home/.config/opencode/agent/planner.md',
    scope: 'global',
    description: 'Plans tasks step by step',
    mode: 'subagent',
    tools: {},
    body: '',
    rawContents: '',
  },
  {
    name: 'reviewer',
    filePath: '/home/.config/opencode/agent/reviewer.md',
    scope: 'global',
    description: 'Global reviewer — shadowed by project one',
    mode: 'subagent',
    tools: {},
    body: '',
    rawContents: '',
    overridden: true,
  },
];

describe('filterAgents', () => {
  it('returns all agents when query is empty', () => {
    expect(filterAgents(AGENTS, '')).toHaveLength(3);
    expect(filterAgents(AGENTS, '   ')).toHaveLength(3);
  });

  it('filters by name (case-insensitive)', () => {
    const result = filterAgents(AGENTS, 'PLAN');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('planner');
  });

  it('filters by description (case-insensitive)', () => {
    const result = filterAgents(AGENTS, 'step by step');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('planner');
  });

  it('returns empty when nothing matches', () => {
    expect(filterAgents(AGENTS, 'nothing-matches-this')).toHaveLength(0);
  });
});

describe('groupAgentsByScope', () => {
  it('separates project and global agents', () => {
    const { project, global } = groupAgentsByScope(AGENTS);
    expect(project.map((a) => a.name)).toEqual(['reviewer']);
    // Global reviewer is overridden and must be excluded.
    expect(global.map((a) => a.name)).toEqual(['planner']);
  });

  it('returns empty arrays for empty input', () => {
    const { project, global } = groupAgentsByScope([]);
    expect(project).toEqual([]);
    expect(global).toEqual([]);
  });

  it('includes non-overridden globals', () => {
    const onlyGlobal: AgentDefinition[] = [
      {
        name: 'g1',
        filePath: '/g1.md',
        scope: 'global',
        description: 'd',
        mode: 'subagent',
        tools: {},
        body: '',
        rawContents: '',
      },
    ];
    expect(groupAgentsByScope(onlyGlobal).global).toHaveLength(1);
  });
});
