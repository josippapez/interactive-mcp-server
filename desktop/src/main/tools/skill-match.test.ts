import { describe, it, expect } from 'vitest';
import {
  tokenise,
  matchSkillsForMessage,
  buildSkillSuggestionText,
  type SkillSummary,
} from './skill-match';

describe('tokenise', () => {
  it('splits on non-alphanumeric boundaries and lowercases', () => {
    expect(tokenise('Hello World')).toContain('hello');
    expect(tokenise('Hello World')).toContain('world');
  });

  it('filters stop words', () => {
    expect(tokenise('the quick brown fox')).not.toContain('the');
  });

  it('filters tokens shorter than 3 chars', () => {
    const result = tokenise('do it now');
    expect(result).not.toContain('do');
    expect(result).not.toContain('it');
    expect(result).toContain('now');
  });

  it('handles hyphens and underscores as boundaries', () => {
    const result = tokenise('code-review workflow');
    expect(result).toContain('code');
    expect(result).toContain('review');
    expect(result).toContain('workflow');
  });

  it('returns empty array for text with only stop words', () => {
    expect(tokenise('the and or')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenise('')).toEqual([]);
  });
});

describe('matchSkillsForMessage', () => {
  const skills: SkillSummary[] = [
    {
      name: 'code-review',
      description:
        'Step-by-step code review workflow covering correctness, readability, performance, security, and tests',
    },
    {
      name: 'debugging',
      description:
        'Systematic debugging workflow: reproduce, narrow scope, hypothesize, verify, fix root cause, add regression test',
    },
    {
      name: 'wcag-a11y',
      description:
        'Skill for WCAG 2.2 A/AA accessibility audits and remediation on web and mobile UI',
    },
    {
      name: 'react-best-practices',
      description:
        'React performance optimization guidelines from Vercel Engineering',
    },
  ];

  it('returns empty array when there are no skills', () => {
    expect(matchSkillsForMessage('review my code', [])).toEqual([]);
  });

  it('returns empty array when user message is empty', () => {
    expect(matchSkillsForMessage('', skills)).toEqual([]);
  });

  it('returns empty array when message has only stop words', () => {
    expect(matchSkillsForMessage('the and or', skills)).toEqual([]);
  });

  it('matches a skill whose name matches a query token', () => {
    const result = matchSkillsForMessage(
      'can you help debug this error',
      skills,
    );
    expect(result.some((s) => s.name === 'debugging')).toBe(true);
  });

  it('matches a skill whose description contains a query token', () => {
    const result = matchSkillsForMessage(
      'please review my code quality',
      skills,
    );
    expect(result.some((s) => s.name === 'code-review')).toBe(true);
  });

  it('matches accessibility skill for a11y-related message', () => {
    const result = matchSkillsForMessage(
      'can you audit accessibility and check WCAG compliance',
      skills,
    );
    expect(result.some((s) => s.name === 'wcag-a11y')).toBe(true);
  });

  it('matches react skill for a React-related message', () => {
    const result = matchSkillsForMessage(
      'help me optimize my React components performance',
      skills,
    );
    expect(result.some((s) => s.name === 'react-best-practices')).toBe(true);
  });

  it('returns multiple matches when message is broad', () => {
    const result = matchSkillsForMessage(
      'review my code and debug the failing test',
      skills,
    );
    // Should match both code-review (review) and debugging (debug/test)
    expect(result.length).toBeGreaterThan(1);
  });

  it('does not match skills unrelated to the message', () => {
    const result = matchSkillsForMessage('deploy to production server', skills);
    // None of the skills above are about deployment
    expect(result).toHaveLength(0);
  });

  it('returns empty array for a very short meaningless message', () => {
    const result = matchSkillsForMessage('hi', skills);
    expect(result).toHaveLength(0);
  });
});

describe('buildSkillSuggestionText', () => {
  it('returns empty string when no skills match', () => {
    expect(buildSkillSuggestionText([])).toBe('');
  });

  it('wraps a single suggestion in a system-reminder block', () => {
    const matched: SkillSummary[] = [
      { name: 'code-review', description: 'Step-by-step code review workflow' },
    ];
    const text = buildSkillSuggestionText(matched);
    expect(text).toContain('<system-reminder>');
    expect(text).toContain('</system-reminder>');
    expect(text).toContain('[Skill suggestion:');
    expect(text).toContain('"code-review"');
  });

  it('includes all matched skills when multiple match', () => {
    const matched: SkillSummary[] = [
      { name: 'code-review', description: 'Code review workflow' },
      { name: 'debugging', description: 'Debugging workflow' },
    ];
    const text = buildSkillSuggestionText(matched);
    expect(text).toContain('"code-review"');
    expect(text).toContain('"debugging"');
  });

  it('mentions the skill tool in the suggestion', () => {
    const matched: SkillSummary[] = [
      { name: 'code-review', description: 'Code review' },
    ];
    const text = buildSkillSuggestionText(matched);
    expect(text).toContain('skill tool');
  });
});
