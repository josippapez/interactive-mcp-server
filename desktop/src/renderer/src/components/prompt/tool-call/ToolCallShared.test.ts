import { describe, expect, it } from 'vitest';
import { guessOutputLanguage } from './ToolCallShared';

describe('guessOutputLanguage', () => {
  it('recognises bash output with shell prompts', () => {
    expect(guessOutputLanguage('$ npm test\nPASS src/example.test.ts')).toBe(
      'bash',
    );
    expect(guessOutputLanguage('> git status\nOn branch main')).toBe('bash');
  });

  it('recognises bash output with common shell commands', () => {
    expect(guessOutputLanguage('npm install\nadded 12 packages')).toBe('bash');
    expect(guessOutputLanguage('git status\nOn branch main')).toBe('bash');
  });

  it('does not classify plain prose as bash', () => {
    expect(guessOutputLanguage('Final result from the tool')).toBeNull();
  });
});
