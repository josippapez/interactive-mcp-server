import { describe, expect, it } from 'vitest';
import {
  extractVisibleErrorsForFile,
  guessOutputLanguage,
} from './ToolCallShared';

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

describe('extractVisibleErrorsForFile', () => {
  it('returns only the first three severity-1 diagnostics for the file', () => {
    const metadata = {
      diagnostics: {
        '/repo/src/App.tsx': [
          { severity: 2, message: 'warn' },
          { severity: 1, message: 'error 1' },
          { severity: 1, message: 'error 2' },
          { severity: 1, message: 'error 3' },
          { severity: 1, message: 'error 4' },
        ],
      },
    };

    expect(extractVisibleErrorsForFile(metadata, '/repo/src/App.tsx')).toEqual([
      { severity: 1, message: 'error 1' },
      { severity: 1, message: 'error 2' },
      { severity: 1, message: 'error 3' },
    ]);
  });

  it('checks normalized path keys before falling back to suffix matching', () => {
    const metadata = {
      diagnostics: {
        '/repo/src/App.tsx': [{ severity: 1, message: 'normalized' }],
        'src/App.tsx': [{ severity: 1, message: 'suffix' }],
      },
    };

    expect(
      extractVisibleErrorsForFile(metadata, '/repo\\src\\App.tsx'),
    ).toEqual([{ severity: 1, message: 'normalized' }]);
  });
});
