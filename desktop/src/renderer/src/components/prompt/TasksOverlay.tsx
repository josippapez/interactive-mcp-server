import { memo, useEffect, useRef } from 'react';
import type { Todo } from '../../hooks/useTodos';
import type { BackgroundSubagentDisplay } from '../../pages/prompt/background-subagents';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import TodoList from './TodoList';

const SubagentElapsedBadge = memo(function SubagentElapsedBadge({
  createdAt,
}: {
  createdAt?: number;
}): React.ReactElement | null {
  const relative = useRelativeTime(new Date(createdAt ?? Date.now()));
  if (!createdAt) return null;
  return (
    <span className="font-mono text-[9px] tabular-nums text-[var(--color-text-faint)]">
      {relative}
    </span>
  );
});

type TasksOverlayProps = {
  /** Whether the overlay is currently visible. */
  open: boolean;
  /** Called when the user dismisses (Escape, click outside, close button). */
  onClose: () => void;
  /** List of todo items to display */
  todos: Todo[];
  /** Whether todos are loading */
  isLoading: boolean;
  /** Error message if todos failed to load */
  error: string | null;
  /** Callback to refresh todos */
  onRefresh: () => void;
  /** Child OpenCode sessions started as background subagents. */
  backgroundSubagents?: BackgroundSubagentDisplay[];
  /** Navigate to a background subagent session. */
  onNavigateToSession?: (sessionId: string) => void;
};

const BackgroundSubagentsList = memo(function BackgroundSubagentsList({
  subagents,
  onNavigateToSession,
}: {
  subagents: BackgroundSubagentDisplay[];
  onNavigateToSession?: (sessionId: string) => void;
}): React.ReactElement | null {
  if (subagents.length === 0) return null;

  return (
    <div className="border-b border-[var(--color-border)] px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Background Agents
        </span>
        <span className="rounded-full bg-[var(--color-agent)]/15 px-1.5 py-0.5 text-[9px] text-[var(--color-agent)]">
          {subagents.filter((subagent) => subagent.status === 'running').length}
        </span>
      </div>
      <div className="space-y-0.5">
        {subagents.map((subagent) => {
          const isRunning = subagent.status === 'running';
          return (
            <button
              key={subagent.id}
              type="button"
              onClick={() => onNavigateToSession?.(subagent.id)}
              className="flex w-full items-start gap-1.5 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-border)]/50 disabled:cursor-default disabled:hover:bg-transparent"
              disabled={!onNavigateToSession}
              title={subagent.id}
              aria-label={`Open background agent ${subagent.title}`}
            >
              <span
                className={`mt-0.5 shrink-0 text-[10px] ${
                  isRunning
                    ? 'animate-pulse text-[var(--color-agent)]'
                    : 'text-[var(--color-success)]'
                }`}
                aria-hidden="true"
              >
                {isRunning ? '◐' : '●'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] leading-relaxed text-[var(--color-text)]">
                  {subagent.title}
                </span>
                <span className="flex items-center gap-1 truncate text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
                  <span>{subagent.status}</span>
                  <SubagentElapsedBadge createdAt={subagent.createdAt} />
                  {subagent.isStalled && (
                    <span className="rounded-full bg-[var(--color-warning-surface)] px-1 py-0.5 text-[8px] font-semibold text-[var(--color-warning)]">
                      stalled
                    </span>
                  )}
                </span>
                {(subagent.model || subagent.variant) && (
                  <span className="block truncate text-[9px] text-[var(--color-text-faint)]">
                    {[subagent.model, subagent.variant]
                      .filter(Boolean)
                      .join(' / ')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Floating slide-in panel anchored to the right edge of the chat area,
 * showing the todo list for the active OpenCode session.
 *
 * Dismisses on Escape and outside-click. Mounted only when `open` is true.
 */
function TasksOverlay({
  open,
  onClose,
  todos,
  isLoading,
  error,
  onRefresh,
  backgroundSubagents = [],
  onNavigateToSession,
}: TasksOverlayProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape to dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Outside-click to dismiss. Use mousedown so we close before any click handler
  // inside the panel fires on adjacent UI.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const node = panelRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      onClose();
    };
    // Defer registration to next tick so the same click that opened the panel
    // doesn't immediately close it.
    const id = window.setTimeout(() => {
      window.addEventListener('mousedown', onPointer);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Session tasks"
      className="absolute top-2 right-2 bottom-2 z-30 flex w-80 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] shadow-xl animate-in fade-in-0 slide-in-from-right-4"
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Tasks
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          aria-label="Close tasks panel"
          title="Close tasks panel (Esc)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 3l10 10M13 3 3 13" />
          </svg>
        </button>
      </div>
      <BackgroundSubagentsList
        subagents={backgroundSubagents}
        onNavigateToSession={onNavigateToSession}
      />
      <TodoList
        todos={todos}
        isLoading={isLoading}
        error={error}
        onRefresh={onRefresh}
      />
    </div>
  );
}

export default memo(TasksOverlay);
