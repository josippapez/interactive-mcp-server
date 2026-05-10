import { memo, useEffect, useRef } from 'react';
import type { Todo } from '../../hooks/useTodos';
import TodoList from './TodoList';

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
};

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
