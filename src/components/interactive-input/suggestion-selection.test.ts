import { describe, expect, it } from 'bun:test';
import { resolveSuggestionSelection } from './suggestion-selection.js';

describe('resolveSuggestionSelection', () => {
  it('applies highlighted non-first shared-prefix suggestion', () => {
    const suggestions = [
      'src/components/',
      'src/components/InteractiveInput.tsx',
      'src/components/MarkdownText.tsx',
    ];

    const result = resolveSuggestionSelection({
      suggestions,
      selectedSuggestionIndex: 0,
      latestHighlightedSuggestionIndex: 1,
    });

    expect(result).toEqual({
      index: 1,
      suggestion: 'src/components/InteractiveInput.tsx',
    });
  });

  it('applies highlighted folder suggestion in mixed file+folder results', () => {
    const suggestions = ['src/utils.ts', 'src/utils/', 'src/utils/format.ts'];

    const result = resolveSuggestionSelection({
      suggestions,
      selectedSuggestionIndex: 0,
      latestHighlightedSuggestionIndex: 1,
    });

    expect(result).toEqual({
      index: 1,
      suggestion: 'src/utils/',
    });
  });

  it('prefers latest highlighted index over stale callback index', () => {
    const suggestions = ['README.md', 'docs/', 'docs/guide.md'];

    const result = resolveSuggestionSelection({
      suggestions,
      selectedSuggestionIndex: 0,
      latestHighlightedSuggestionIndex: 2,
    });

    expect(result).toEqual({
      index: 2,
      suggestion: 'docs/guide.md',
    });
  });
});
