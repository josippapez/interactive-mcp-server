import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from './agents';
import { mergeAgentSources } from './agents';

function agent(
  name: string,
  source: 'sdk' | 'project' | 'global',
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name,
    filePath: source === 'sdk' ? `opencode-sdk:${name}` : `/repo/${name}.md`,
    scope: source === 'project' ? 'project' : 'global',
    description: `${name} from ${source}`,
    mode: 'subagent',
    tools: {},
    body: '',
    rawContents: '',
    editable: source !== 'sdk',
    ...overrides,
  };
}

describe('mergeAgentSources', () => {
  it('uses SDK agents as the primary display source', () => {
    const result = mergeAgentSources(
      [agent('oracle', 'sdk', { native: false })],
      [],
      [],
    );

    expect(result).toMatchObject([
      {
        name: 'oracle',
        filePath: 'opencode-sdk:oracle',
        editable: false,
        native: false,
      },
    ]);
  });

  it('adds local edit metadata when a markdown file backs an SDK agent', () => {
    const result = mergeAgentSources(
      [agent('docs-maintainer', 'sdk', { description: 'resolved by server' })],
      [
        agent('docs-maintainer', 'project', {
          filePath: '/repo/.opencode/agent/docs-maintainer.md',
          body: 'local prompt',
          rawContents: 'raw local prompt',
        }),
      ],
      [],
    );

    expect(result).toMatchObject([
      {
        name: 'docs-maintainer',
        description: 'resolved by server',
        filePath: '/repo/.opencode/agent/docs-maintainer.md',
        scope: 'project',
        body: 'local prompt',
        rawContents: 'raw local prompt',
        editable: true,
      },
    ]);
  });

  it('keeps local-only markdown agents as a fallback', () => {
    const result = mergeAgentSources(
      [agent('build', 'sdk')],
      [agent('project-only', 'project')],
      [agent('global-only', 'global')],
    );

    expect(result.map((item) => item.name)).toEqual([
      'build',
      'project-only',
      'global-only',
    ]);
  });
});
