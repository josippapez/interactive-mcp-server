import { describe, expect, it } from 'vitest';
import {
  formatReviewCommentPrompt,
  getReviewFileIcon,
  normalizeReviewPanelWidth,
  shouldMountReviewDiff,
  normalizeReviewDiffs,
  parseReviewDiffPatch,
  splitReviewPath,
} from './review-sidebar-utils';

describe('review-sidebar-utils', () => {
  it('normalizes review diffs with stable ids and totals', () => {
    const result = normalizeReviewDiffs([
      { file: 'src/app.ts', additions: 3, deletions: 1, status: 'modified' },
      { file: 'src/new.ts', additions: 2, deletions: 0, status: 'added' },
    ]);

    expect(result.totalAdditions).toBe(5);
    expect(result.totalDeletions).toBe(1);
    expect(result.files.map((file) => file.id)).toEqual([
      'src/app.ts:0',
      'src/new.ts:1',
    ]);
  });

  it('drops diffs without file paths', () => {
    const result = normalizeReviewDiffs([
      { additions: 1, deletions: 1 },
      { file: 'src/app.ts', additions: 1, deletions: 0 },
    ]);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe('src/app.ts');
  });

  it('parses unified patch text into renderable diff lines', () => {
    const lines = parseReviewDiffPatch(
      '@@ -1,2 +1,2 @@\n const a = 1\n-old\n+new',
    );

    expect(lines).toEqual([
      {
        type: 'hunk',
        content: '@@ -1,2 +1,2 @@',
        oldLineNumber: null,
        newLineNumber: null,
      },
      {
        type: 'context',
        content: 'const a = 1',
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: 'removal',
        content: 'old',
        oldLineNumber: 2,
        newLineNumber: null,
      },
      {
        type: 'addition',
        content: 'new',
        oldLineNumber: null,
        newLineNumber: 2,
      },
    ]);
  });

  it('splits review paths for opencode-style truncation', () => {
    expect(splitReviewPath('src/renderer/App.tsx')).toEqual({
      directory: 'src/renderer/',
      filename: 'App.tsx',
    });
  });

  it('formats review comments for injection into the session', () => {
    expect(
      formatReviewCommentPrompt({
        file: 'src/app.ts',
        lineNumber: 12,
        side: 'new',
        comment: 'Please simplify this.',
        preview: 'const value = compute();',
      }),
    ).toContain('Review comment on src/app.ts:12 (new side)');
  });

  it('chooses icons from common file names and extensions', () => {
    expect(getReviewFileIcon('src/App.tsx')).toEqual({
      label: 'TSX',
      tone: 'blue',
    });
    expect(getReviewFileIcon('package.json')).toEqual({
      label: 'NPM',
      tone: 'red',
    });
    expect(getReviewFileIcon('README.md')).toEqual({
      label: 'MD',
      tone: 'neutral',
    });
  });

  it('clamps review panel width to viewport-aware bounds', () => {
    expect(normalizeReviewPanelWidth(100, 1200)).toBe(420);
    expect(normalizeReviewPanelWidth(900, 1200)).toBe(780);
    expect(normalizeReviewPanelWidth(620, 1200)).toBe(620);
  });

  it('mounts only prioritized review diffs until explicitly enabled', () => {
    expect(shouldMountReviewDiff({ index: 0, open: true, force: false })).toBe(
      true,
    );
    expect(shouldMountReviewDiff({ index: 3, open: true, force: false })).toBe(
      false,
    );
    expect(shouldMountReviewDiff({ index: 3, open: true, force: true })).toBe(
      true,
    );
    expect(shouldMountReviewDiff({ index: 0, open: false, force: true })).toBe(
      false,
    );
  });
});
