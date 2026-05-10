import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../../../../preload';
import {
  getDefaultNativeAgentName,
  groupAgentsByScope,
} from './agent-picker-filter';

function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: 'custom',
    filePath: 'custom.md',
    scope: 'global',
    description: '',
    mode: 'subagent',
    tools: {},
    body: '',
    rawContents: '',
    ...overrides,
  };
}

describe('getDefaultNativeAgentName', () => {
  it('prefers an explicit default agent', () => {
    expect(
      getDefaultNativeAgentName(
        [agent({ name: 'build', mode: 'primary', native: true })],
        'custom-default',
      ),
    ).toBe('custom-default');
  });

  it('returns the first native primary agent', () => {
    expect(
      getDefaultNativeAgentName([
        agent({ name: 'explore', mode: 'subagent', native: true }),
        agent({ name: 'build', mode: 'primary', native: true }),
      ]),
    ).toBe('build');
  });

  it('returns null when no native primary agent is available', () => {
    expect(getDefaultNativeAgentName([agent({ name: 'custom' })])).toBeNull();
  });
});

describe('groupAgentsByScope', () => {
  it('routes native agents into the builtIn bucket regardless of scope', () => {
    const result = groupAgentsByScope([
      agent({ name: 'build', native: true, scope: 'global' }),
      agent({ name: 'plan', native: true, scope: 'global' }),
    ]);
    expect(result.builtIn.map((a) => a.name)).toEqual(['build', 'plan']);
    expect(result.global).toEqual([]);
    expect(result.project).toEqual([]);
  });

  it('separates project, global, and builtIn agents', () => {
    const result = groupAgentsByScope([
      agent({ name: 'build', native: true, scope: 'global' }),
      agent({ name: 'mine', scope: 'project' }),
      agent({ name: 'shared', scope: 'global' }),
    ]);
    expect(result.builtIn.map((a) => a.name)).toEqual(['build']);
    expect(result.project.map((a) => a.name)).toEqual(['mine']);
    expect(result.global.map((a) => a.name)).toEqual(['shared']);
  });

  it('drops overridden global agents', () => {
    const result = groupAgentsByScope([
      agent({ name: 'shadowed', scope: 'global', overridden: true }),
      agent({ name: 'visible', scope: 'global' }),
    ]);
    expect(result.global.map((a) => a.name)).toEqual(['visible']);
  });
});
