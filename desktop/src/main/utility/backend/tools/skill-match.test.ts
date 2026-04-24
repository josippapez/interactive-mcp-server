import { describe, expect, it } from 'vitest';

import {
  buildSkillSuggestionText,
  matchSkillsForMessage,
  type SkillSummary,
} from './skill-match';

const skills: SkillSummary[] = [
  {
    name: 'pull-request-review',
    description: 'Review pull request changes and summarize risks',
  },
  {
    name: 'run-tests',
    description: 'Run tests and verify the codebase before handoff',
  },
  {
    name: 'docs-maintainer',
    description:
      'Update documentation and keep docs aligned to shipped behavior',
  },
];

describe('matchSkillsForMessage', () => {
  it('matches multi-word phrases from skill descriptions', () => {
    const matched = matchSkillsForMessage(
      'Can you review this pull request?',
      skills,
    );

    expect(matched.map((skill) => skill.name)).toEqual(['pull-request-review']);
  });

  it('caps results to the strongest two matches', () => {
    const matched = matchSkillsForMessage(
      'Review the docs and run tests before handoff',
      skills,
    );

    expect(matched).toHaveLength(2);
    expect(matched.map((skill) => skill.name)).toEqual([
      'run-tests',
      'pull-request-review',
    ]);
    expect(matched.map((skill) => skill.name)).not.toContain('docs-maintainer');
  });
});

describe('buildSkillSuggestionText', () => {
  it('emits only the capped set of suggestions', () => {
    const suggestion = buildSkillSuggestionText(skills);

    expect(suggestion).toContain('run-tests');
    expect(suggestion).toContain('pull-request-review');
    expect(suggestion).not.toContain('docs-maintainer');
  });
});
