export interface ResolveSuggestionSelectionArgs {
  suggestions: string[];
  selectedSuggestionIndex: number;
  latestHighlightedSuggestionIndex?: number;
}

export const resolveSuggestionSelection = ({
  suggestions,
  selectedSuggestionIndex,
  latestHighlightedSuggestionIndex,
}: ResolveSuggestionSelectionArgs): {
  index: number;
  suggestion: string;
} | null => {
  if (suggestions.length === 0) {
    return null;
  }

  const preferredIndex =
    latestHighlightedSuggestionIndex ?? selectedSuggestionIndex;
  const clampedIndex = Math.max(
    0,
    Math.min(preferredIndex, suggestions.length - 1),
  );
  const suggestion = suggestions[clampedIndex];

  if (!suggestion) {
    return null;
  }

  return { index: clampedIndex, suggestion };
};
