import { describe, expect, it } from 'vitest';
import { getMarkdownProseClasses } from './markdown-renderer';

describe('getMarkdownProseClasses', () => {
  it('sets visible list marker colors in light mode', () => {
    expect(getMarkdownProseClasses(false)).toContain(
      'prose-li:marker:text-[var(--color-text-muted)]',
    );
  });
});
