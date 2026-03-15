import { describe, expect, it } from 'bun:test';

import { getTextareaHighlightRanges } from './textarea-highlighting.js';

describe('getTextareaHighlightRanges', () => {
  it('detects links in free text and markdown links', () => {
    const input =
      'Visit https://example.com and [docs](https://example.com/docs).';
    const ranges = getTextareaHighlightRanges(input);
    const linkTexts = ranges
      .filter((range) => range.kind === 'link')
      .map((range) => input.slice(range.start, range.end));

    expect(linkTexts).toEqual([
      'https://example.com',
      '[docs](https://example.com/docs)',
    ]);
  });

  it('detects inline code and fenced code blocks as code', () => {
    const input = 'Use `bun run build` and ```ts\nconst x = 1;\n``` now.';
    const ranges = getTextareaHighlightRanges(input);
    const codeTexts = ranges
      .filter((range) => range.kind === 'code')
      .map((range) => input.slice(range.start, range.end));

    expect(codeTexts).toEqual(['`bun run build`', '```ts\nconst x = 1;\n```']);
  });

  it('returns ranges in source order without overlap', () => {
    const input =
      '```tsx\nconst url = "https://inside.code";\n```\n`code` https://a.dev `more`';
    const ranges = getTextareaHighlightRanges(input);

    expect(ranges.map((range) => range.kind)).toContain('link');
    expect(
      ranges.some(
        (range) =>
          input.slice(range.start, range.end) === 'https://inside.code',
      ),
    ).toBe(false);
    expect(
      ranges.every(
        (range, index) =>
          index === 0 || ranges[index - 1]!.end <= ranges[index]!.start,
      ),
    ).toBe(true);
  });
});
