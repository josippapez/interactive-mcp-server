import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  useCommands,
  filterCommands,
  type Command,
} from '../../hooks/useCommands';

interface CommandPaletteProps {
  /** The session ID to execute commands in */
  sessionId: string | null;
  /** Whether the palette is open */
  open: boolean;
  /** Callback to close the palette */
  onClose: () => void;
  /** Position to anchor the palette */
  anchorPosition?: { top: number; left: number };
  /** Initial search query (e.g., text after "/") */
  initialQuery?: string;
  /** Callback when a command is successfully executed */
  onCommandExecuted?: (commandName: string) => void;
}

/** Slash command icon */
function SlashIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 14L11 2" />
    </svg>
  );
}

/** Checkmark icon for required args */
function RequiredDot(): React.ReactElement {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-[var(--color-error)] inline-block"
      title="Required"
    />
  );
}

/** Loading spinner */
function Spinner(): React.ReactElement {
  return (
    <svg
      className="animate-spin w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="8" cy="8" r="6" className="opacity-25" />
      <path d="M8 2a6 6 0 0 1 6 6" className="opacity-75" />
    </svg>
  );
}

export default function CommandPalette({
  sessionId,
  open,
  onClose,
  anchorPosition,
  initialQuery = '',
  onCommandExecuted,
}: CommandPaletteProps): React.ReactElement | null {
  const { commands, isLoading, error, execute, isExecuting, refresh } =
    useCommands();
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands based on search query
  const filteredCommands = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
    setExecutionError(null);
  }, [query]);

  // Update query when initialQuery changes (e.g., user types after /)
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // Focus input when palette opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && filteredCommands.length > 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, filteredCommands.length]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : prev,
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleExecute(filteredCommands[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        // Allow Tab to cycle through options
        e.preventDefault();
        if (e.shiftKey) {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1,
          );
        } else {
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0,
          );
        }
        break;
    }
  };

  // Execute the selected command
  const handleExecute = async (command: Command) => {
    if (!sessionId) {
      setExecutionError('No active session');
      return;
    }

    if (isExecuting) return;

    setExecutionError(null);

    // For now, execute without args (could extend to show arg input dialog)
    const result = await execute(sessionId, command.name);

    if (result.ok) {
      onCommandExecuted?.(command.name);
      onClose();
    } else {
      setExecutionError(result.error ?? 'Command failed');
    }
  };

  if (!open) return null;

  const style: React.CSSProperties = anchorPosition
    ? {
        position: 'fixed',
        top: anchorPosition.top,
        left: anchorPosition.left,
        transform: 'translateY(-100%)', // Position above the anchor
      }
    : {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: '4px',
      };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        className="z-50 w-[320px] max-h-[360px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl overflow-hidden flex flex-col"
        style={style}
        role="dialog"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <SlashIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {isExecuting && <Spinner />}
        </div>

        {/* Error message */}
        {(error || executionError) && (
          <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[var(--color-error)]/10 border-b border-[var(--color-border)]">
            {executionError ?? error}
          </div>
        )}

        {/* Command list */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {isLoading && commands.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[var(--color-text-faint)]">
              <Spinner />
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-[var(--color-text-faint)]">
              {query
                ? `No commands matching "${query}"`
                : 'No commands available'}
              <button
                type="button"
                onClick={() => void refresh()}
                className="block mx-auto mt-2 text-xs text-[var(--color-agent)] hover:underline"
              >
                Refresh
              </button>
            </div>
          ) : (
            filteredCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                onClick={() => handleExecute(command)}
                onMouseEnter={() => setSelectedIndex(index)}
                disabled={isExecuting}
                className={`w-full px-3 py-2 text-left flex flex-col gap-0.5 transition-colors ${
                  index === selectedIndex
                    ? 'bg-[var(--color-agent)]/10'
                    : 'hover:bg-[var(--color-surface-alt)]'
                } ${isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-agent)]">
                    /{command.name}
                  </span>
                  {command.args.some((a) => a.required) && <RequiredDot />}
                </div>
                <span className="text-xs text-[var(--color-text-muted)] line-clamp-2">
                  {command.description}
                </span>
                {command.args.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {command.args.map((arg) => (
                      <span
                        key={arg.name}
                        className={`text-[10px] px-1 py-0.5 rounded ${
                          arg.required
                            ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                            : 'bg-[var(--color-surface-alt)] text-[var(--color-text-faint)]'
                        }`}
                        title={arg.description}
                      >
                        {arg.name}
                        {arg.required && '*'}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
              ↑↓
            </kbd>{' '}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
              Enter
            </kbd>{' '}
            execute
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
              Esc
            </kbd>{' '}
            close
          </span>
        </div>
      </div>
    </>
  );
}
