import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SessionSearchResult {
  sessionId: string;
  channelName: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageSearchResult {
  id: number;
  sessionId: string;
  sessionName: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  snippet: string;
  createdAt: string;
}

export interface GlobalSearchResult {
  sessions: SessionSearchResult[];
  messages: MessageSearchResult[];
}

export type SearchResultItem =
  | { type: 'session'; data: SessionSearchResult }
  | { type: 'message'; data: MessageSearchResult };

export type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult: (result: SearchResultItem) => void;
};

// ─── Helper functions (exported for testing) ──────────────────────────────

/**
 * Highlight matching text in a string.
 * Returns an array of segments with a `highlight` flag.
 */
export function highlightMatches(
  text: string,
  query: string,
): { text: string; highlight: boolean }[] {
  if (!query.trim()) {
    return [{ text, highlight: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const segments: { text: string; highlight: boolean }[] = [];

  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex !== -1) {
    // Add non-matching segment before this match
    if (matchIndex > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, matchIndex),
        highlight: false,
      });
    }

    // Add the matching segment
    segments.push({
      text: text.slice(matchIndex, matchIndex + lowerQuery.length),
      highlight: true,
    });

    lastIndex = matchIndex + lowerQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      highlight: false,
    });
  }

  return segments.length > 0 ? segments : [{ text, highlight: false }];
}

/**
 * Flatten search results into a single list for keyboard navigation.
 */
export function flattenResults(
  results: GlobalSearchResult,
): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  // Sessions first
  for (const session of results.sessions) {
    items.push({ type: 'session', data: session });
  }

  // Then messages
  for (const message of results.messages) {
    items.push({ type: 'message', data: message });
  }

  return items;
}

// ─── Component ─────────────────────────────────────────────────────────────

const GlobalSearch = memo(function GlobalSearch({
  isOpen,
  onClose,
  onSelectResult,
}: Props): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult>({
    sessions: [],
    messages: [],
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Flatten results for keyboard navigation
  const flatResults = useMemo(() => flattenResults(results), [results]);

  // Search when query changes (debounced)
  useEffect(() => {
    if (!isOpen) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults({ sessions: [], messages: [] });
      return;
    }

    setIsLoading(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const searchResults = await window.api.searchGlobal(trimmedQuery, {
          sessionLimit: 10,
          messageLimit: 15,
        });
        setResults(searchResults);
      } catch (error) {
        console.error('Global search failed:', error);
        setResults({ sessions: [], messages: [] });
      } finally {
        setIsLoading(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults({ sessions: [], messages: [] });
      setSelectedIndex(0);
      setIsLoading(false);
      // Focus input after a brief delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= flatResults.length) {
      setSelectedIndex(Math.max(0, flatResults.length - 1));
    }
  }, [flatResults.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedEl = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (item: SearchResultItem) => {
      onSelectResult(item);
      onClose();
    },
    [onSelectResult, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatResults.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : flatResults.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (flatResults[selectedIndex]) {
            handleSelect(flatResults[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatResults, selectedIndex, handleSelect, onClose],
  );

  if (!isOpen) return null;

  // Track cumulative index for keyboard navigation
  let cumulativeIndex = 0;

  const renderHighlightedText = (text: string) => {
    const segments = highlightMatches(text, query);
    return segments.map((segment, i) =>
      segment.highlight ? (
        <mark
          key={i}
          className="bg-[var(--color-agent)]/30 text-[var(--color-agent)] rounded-sm px-0.5"
        >
          {segment.text}
        </mark>
      ) : (
        <span key={i}>{segment.text}</span>
      ),
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-sm w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-faint)]">🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search sessions and messages..."
              className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none"
            />
            {isLoading && (
              <span className="text-[var(--color-text-faint)] text-xs">
                ...
              </span>
            )}
            <kbd className="px-1.5 py-0.5 rounded-sm bg-[var(--color-kbd-bg)] text-[var(--color-text-faint)] font-mono text-[10px]">
              ESC
            </kbd>
          </div>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto"
          role="listbox"
          aria-label="Global search results"
        >
          {!query.trim() ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
              Type to search across all sessions and messages
            </div>
          ) : flatResults.length === 0 && !isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
              No results for "{query}"
            </div>
          ) : (
            <>
              {/* Sessions section */}
              {results.sessions.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] bg-[var(--color-surface-alt)]">
                    Sessions ({results.sessions.length})
                  </div>
                  {results.sessions.map((session, i) => {
                    const index = cumulativeIndex + i;
                    const isSelected = index === selectedIndex;

                    return (
                      <button
                        key={`session-${session.sessionId}`}
                        type="button"
                        data-index={index}
                        onClick={() =>
                          handleSelect({ type: 'session', data: session })
                        }
                        className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                            : 'text-[var(--color-text)] hover:bg-[var(--color-border)]'
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="w-5 text-center text-sm shrink-0 text-[var(--color-text-faint)]">
                          ⬡
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {renderHighlightedText(session.channelName)}
                          </div>
                          {session.projectName && (
                            <p className="text-xs text-[var(--color-text-faint)] truncate">
                              {renderHighlightedText(session.projectName)}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Update cumulative index after sessions */}
              {(() => {
                cumulativeIndex += results.sessions.length;
                return null;
              })()}

              {/* Messages section */}
              {results.messages.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] bg-[var(--color-surface-alt)]">
                    Messages ({results.messages.length})
                  </div>
                  {results.messages.map((message, i) => {
                    const index = cumulativeIndex + i;
                    const isSelected = index === selectedIndex;

                    return (
                      <button
                        key={`message-${message.id}`}
                        type="button"
                        data-index={index}
                        onClick={() =>
                          handleSelect({ type: 'message', data: message })
                        }
                        className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                            : 'text-[var(--color-text)] hover:bg-[var(--color-border)]'
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span
                          className={`w-5 text-center text-sm shrink-0 ${
                            message.messageType === 'question'
                              ? 'text-[var(--color-agent)]'
                              : message.messageType === 'answer'
                                ? 'text-[var(--color-user)]'
                                : 'text-[var(--color-text-faint)]'
                          }`}
                        >
                          {message.messageType === 'question'
                            ? '?'
                            : message.messageType === 'answer'
                              ? '›'
                              : '○'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-[var(--color-text-muted)] mb-0.5 truncate">
                            {message.sessionName}
                          </div>
                          <p className="text-sm leading-relaxed line-clamp-2">
                            {renderHighlightedText(message.snippet)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <div className="flex items-center justify-center gap-4 text-[10px] text-[var(--color-text-faint)]">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-sm bg-[var(--color-kbd-bg)]">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-sm bg-[var(--color-kbd-bg)]">
                ↵
              </kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-sm bg-[var(--color-kbd-bg)]">
                ESC
              </kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default GlobalSearch;
