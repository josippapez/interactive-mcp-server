import { describe, expect, it } from 'vitest';
import { filterMessageText } from './message-item-helpers';

describe('filterMessageText', () => {
  it('removes visible doc injection summaries when hideDocInjections is enabled', () => {
    const text = [
      '**Context injected (5 docs):**',
      '1. `README.md`',
      '2. `.github/skills/react-best-practices/SKILL.md`',
      '',
      'Regular message body.',
    ].join('\n');

    expect(filterMessageText(text, false, true)).toBe('Regular message body.');
  });

  it('preserves visible doc injection summaries when hideDocInjections is disabled', () => {
    const text = [
      '**Context injected (1 docs):**',
      '1. `README.md`',
    ].join('\n');

    expect(filterMessageText(text, false, false)).toContain(
      'Context injected (1 docs)',
    );
  });
});
