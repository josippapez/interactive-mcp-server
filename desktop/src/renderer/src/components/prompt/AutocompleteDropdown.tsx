import { useRef, useEffect } from 'react';

type Props = {
  suggestions: string[];
  selectedIndex: number;
  isLoading: boolean;
  triggerChar: '#' | '@';
  onSelect: (path: string) => void;
  onHoverIndex: (index: number) => void;
};

export default function AutocompleteDropdown({
  suggestions,
  selectedIndex,
  isLoading,
  triggerChar,
  onSelect,
  onHoverIndex,
}: Props): React.ReactElement {
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!suggestionsRef.current) return;
    const selected = suggestionsRef.current.children[
      selectedIndex
    ] as HTMLElement;
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="absolute left-4 right-16 bottom-full mb-1 z-50 bg-[var(--color-surface-raised)] border border-[var(--color-border-weak)] rounded-[12px] shadow-xl max-h-64 overflow-y-auto p-2"
      ref={suggestionsRef}
    >
      <div className="px-2 pb-1.5 text-[10px] text-[var(--color-text-muted)]">
        {triggerChar === '@' ? '📎 File reference' : '# File search'}
      </div>
      {isLoading && suggestions.length === 0 ? (
        <div className="px-2 py-1 text-xs text-[var(--color-text-muted)] italic">
          Indexing…
        </div>
      ) : suggestions.length === 0 && !isLoading ? (
        <div className="px-2 py-1 text-xs text-[var(--color-text-muted)] italic">
          No matches
        </div>
      ) : (
        suggestions.slice(0, 50).map((filePath, i) => {
          const segments = filePath.split('/');
          const fileName = segments.pop() ?? filePath;
          const dirPath = segments.join('/');
          return (
            <div
              key={filePath}
              className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs rounded-md ${
                i === selectedIndex
                  ? 'bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(filePath);
              }}
              onMouseEnter={() => onHoverIndex(i)}
            >
              <span className="text-[var(--color-text-muted)]">◇</span>
              <span className="truncate">
                {dirPath && (
                  <span className="text-[var(--color-text-muted)] mr-1">
                    {dirPath}/
                  </span>
                )}
                <span className="font-medium">{fileName}</span>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
