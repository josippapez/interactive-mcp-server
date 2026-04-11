import { useState, useRef, useCallback, useEffect } from 'react';

export type AutocompleteTarget = { start: number; end: number; query: string };

export type UseAutocompleteReturn = {
  target: AutocompleteTarget | null;
  suggestions: string[];
  loading: boolean;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  detectAutocomplete: (text: string, cursorPos: number) => void;
  applySuggestion: (
    filePath: string,
    getValue: () => string,
    setValue: (v: string) => void,
    focusTextarea: (cursorPos: number) => void,
  ) => void;
  clearSuggestions: () => void;
};

/**
 * Manages file-path autocomplete triggered by `#` or `@` characters.
 *
 * `applySuggestion` is intentionally parameterised so the hook stays
 * independent of direct DOM refs (the caller passes a `focusTextarea`
 * callback that handles cursor placement).
 */
export function useAutocomplete(baseDirectory?: string): UseAutocompleteReturn {
  const [target, setTarget] = useState<AutocompleteTarget | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setTarget(null);
    setSelectedIndex(0);
  }, []);

  const detectAutocomplete = useCallback(
    (text: string, cursorPos: number) => {
      if (!baseDirectory) {
        clearSuggestions();
        return;
      }
      let triggerIdx = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '#' || ch === '@') {
          triggerIdx = i;
          break;
        }
        if (ch === '\n') break;
      }
      if (triggerIdx === -1) {
        clearSuggestions();
        return;
      }
      const query = text.slice(triggerIdx + 1, cursorPos);
      setTarget({ start: triggerIdx, end: cursorPos, query });
      setSelectedIndex(0);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await window.api.searchFiles(baseDirectory, query);
          setSuggestions(results);
        } catch {
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }, 150);
    },
    [baseDirectory, clearSuggestions],
  );

  const applySuggestion = useCallback(
    (
      filePath: string,
      getValue: () => string,
      setValue: (v: string) => void,
      focusTextarea: (cursorPos: number) => void,
    ) => {
      if (!target) return;
      const value = getValue();
      const before = value.slice(0, target.start);
      const after = value.slice(target.end);
      const next = before + filePath + after;
      setValue(next);
      setSuggestions([]);
      setTarget(null);
      setSelectedIndex(0);
      const newCursor = before.length + filePath.length;
      requestAnimationFrame(() => focusTextarea(newCursor));
    },
    [target],
  );

  // Cleanup debounce timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  return {
    target,
    suggestions,
    loading,
    selectedIndex,
    setSelectedIndex,
    detectAutocomplete,
    applySuggestion,
    clearSuggestions,
  };
}
