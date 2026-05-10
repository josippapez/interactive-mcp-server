import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  useCommands,
  filterCommands,
  type Command,
} from '../../hooks/useCommands';
import type { NativeOpenCodeSkill } from '../../../../preload/api/types';

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
  /** Callback when a skill is selected from the native skill picker */
  onSkillSelected?: (skillName: string) => void;
  /**
   * Project directory to scope command fetch + execution to. Forwarded to the
   * OpenCode SDK via the `x-opencode-directory` header so that project-local
   * commands resolve correctly (otherwise OpenCode falls back to $HOME).
   */
  baseDirectory?: string | null;
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
  onSkillSelected,
  baseDirectory,
}: CommandPaletteProps): React.ReactElement | null {
  const { commands, isLoading, error, execute, isExecuting, refresh } =
    useCommands(true, baseDirectory);
  const [skills, setSkills] = useState<NativeOpenCodeSkill[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands based on search query
  const filteredCommands = useMemo(
    () =>
      filterCommands(
        [
          {
            name: 'skills',
            description: 'Search and reference an available OpenCode skill',
            args: [],
          },
          ...commands,
        ],
        query,
      ),
    [commands, query],
  );

  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle),
    );
  }, [query, skills]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
    setExecutionError(null);
  }, [query]);

  // Update query when initialQuery changes (e.g., user types after /)
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const all = await window.api.listNativeOpenCodeSkills(
          baseDirectory ?? undefined,
        );
        if (!cancelled) setSkills(all);
      } catch {
        if (!cancelled) setSkills([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseDirectory, open]);

  // Focus input when palette opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    const count = showSkillPicker
      ? filteredSkills.length
      : filteredCommands.length;
    if (listRef.current && count > 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [
    selectedIndex,
    filteredCommands.length,
    filteredSkills.length,
    showSkillPicker,
  ]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev <
          (showSkillPicker ? filteredSkills.length : filteredCommands.length) -
            1
            ? prev + 1
            : prev,
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (showSkillPicker && filteredSkills[selectedIndex]) {
          handleSelectSkill(filteredSkills[selectedIndex]);
        } else if (filteredCommands[selectedIndex]) {
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
            prev > 0
              ? prev - 1
              : (showSkillPicker
                  ? filteredSkills.length
                  : filteredCommands.length) - 1,
          );
        } else {
          setSelectedIndex((prev) =>
            prev <
            (showSkillPicker
              ? filteredSkills.length
              : filteredCommands.length) -
              1
              ? prev + 1
              : 0,
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

    if (command.name === 'skills') {
      setShowSkillPicker(true);
      setQuery('');
      setSelectedIndex(0);
      return;
    }

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

  const handleSelectSkill = (skill: NativeOpenCodeSkill) => {
    onSkillSelected?.(skill.name);
    onClose();
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
        className="z-50 w-[320px] max-h-[360px] rounded-[12px] border border-[var(--color-border-weak)] bg-[var(--color-surface-raised)] shadow-xl overflow-hidden flex flex-col"
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
            placeholder={
              showSkillPicker ? 'Search skills...' : 'Search commands...'
            }
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
          {isLoading && commands.length === 0 && !showSkillPicker ? (
            <div className="flex items-center justify-center py-8 text-[var(--color-text-faint)]">
              <Spinner />
            </div>
          ) : (showSkillPicker
              ? filteredSkills.length
              : filteredCommands.length) === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-[var(--color-text-faint)]">
              {query
                ? `No ${showSkillPicker ? 'skills' : 'commands'} matching "${query}"`
                : showSkillPicker
                  ? 'No skills available'
                  : 'No commands available'}
              {!showSkillPicker && (
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="block mx-auto mt-2 text-xs text-[var(--color-agent)] hover:underline"
                >
                  Refresh
                </button>
              )}
            </div>
          ) : showSkillPicker ? (
            filteredSkills.map((skill, index) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => handleSelectSkill(skill)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full px-3 py-2 text-left flex flex-col gap-0.5 transition-colors ${
                  index === selectedIndex
                    ? 'bg-[var(--color-agent)]/10'
                    : 'hover:bg-[var(--color-surface-alt)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-agent)]">
                    /{skill.name}
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--color-agent)]/10 text-[var(--color-agent)]">
                    skill
                  </span>
                </div>
                <span className="text-xs text-[var(--color-text-muted)] line-clamp-2">
                  {skill.description}
                </span>
              </button>
            ))
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
