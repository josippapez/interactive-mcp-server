import { memo, useState } from 'react';
import type { Todo } from '../../hooks/useTodos';

type Props = {
  todos: Todo[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
};

const STATUS_CONFIG: Record<
  Todo['status'],
  { icon: string; label: string; className: string }
> = {
  pending: {
    icon: '○',
    label: 'Pending',
    className: 'text-[var(--color-text-faint)]',
  },
  in_progress: {
    icon: '◐',
    label: 'In Progress',
    className: 'text-[var(--color-user)] animate-pulse',
  },
  completed: {
    icon: '●',
    label: 'Completed',
    className: 'text-[var(--color-success)]',
  },
  cancelled: {
    icon: '✕',
    label: 'Cancelled',
    className: 'text-[var(--color-text-muted)] line-through',
  },
};

const PRIORITY_CONFIG: Record<
  Todo['priority'],
  { icon: string; label: string; className: string }
> = {
  high: {
    icon: '↑',
    label: 'High',
    className: 'text-[var(--color-error)]',
  },
  medium: {
    icon: '→',
    label: 'Medium',
    className: 'text-[var(--color-warning)]',
  },
  low: {
    icon: '↓',
    label: 'Low',
    className: 'text-[var(--color-success)]',
  },
};

/**
 * Memoized todo item component to prevent unnecessary re-renders when
 * the parent list updates but this specific item hasn't changed.
 */
const TodoItem = memo(function TodoItem({
  todo,
}: {
  todo: Todo;
}): React.ReactElement {
  const status = STATUS_CONFIG[todo.status];
  const priority = PRIORITY_CONFIG[todo.priority];

  return (
    <div
      className={`flex items-start gap-1.5 py-1 px-1.5 rounded-sm hover:bg-[var(--color-border)]/50 transition-colors ${
        todo.status === 'cancelled' ? 'opacity-50' : ''
      }`}
    >
      {/* Status icon */}
      <span
        className={`shrink-0 text-[10px] ${status.className}`}
        title={status.label}
      >
        {status.icon}
      </span>

      {/* Content */}
      <span
        className={`flex-1 text-[10px] leading-relaxed break-words ${
          todo.status === 'completed' || todo.status === 'cancelled'
            ? 'text-[var(--color-text-muted)]'
            : 'text-[var(--color-text)]'
        } ${todo.status === 'cancelled' ? 'line-through' : ''}`}
      >
        {todo.content}
      </span>

      {/* Priority badge */}
      <span
        className={`shrink-0 text-[9px] ${priority.className}`}
        title={`${priority.label} priority`}
      >
        {priority.icon}
      </span>
    </div>
  );
});

const TodoList = memo(function TodoList({
  todos,
  isLoading,
  error,
  onRefresh,
}: Props): React.ReactElement {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Group todos by status for better organization
  const pendingTodos = todos.filter((t) => t.status === 'pending');
  const inProgressTodos = todos.filter((t) => t.status === 'in_progress');
  const completedTodos = todos.filter((t) => t.status === 'completed');
  const cancelledTodos = todos.filter((t) => t.status === 'cancelled');

  // Show active todos first (in_progress, then pending), then completed, then cancelled
  const sortedTodos = [
    ...inProgressTodos,
    ...pendingTodos,
    ...completedTodos,
    ...cancelledTodos,
  ];

  const activeCount = pendingTodos.length + inProgressTodos.length;

  // When collapsed, show only header
  if (isCollapsed) {
    return (
      <div className="border-b border-[var(--color-border)]">
        <button
          onClick={() => setIsCollapsed(false)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
          title="Expand tasks panel"
        >
          <span>▸</span>
          <span className="font-medium uppercase tracking-wide">Tasks</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[var(--color-surface-alt)] text-[9px] text-[var(--color-user)]">
              {activeCount}
            </span>
          )}
          {isLoading && (
            <span className="w-2 h-2 rounded-full bg-[var(--color-agent)] animate-pulse" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(true)}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
            title="Collapse tasks panel"
          >
            <span className="text-[10px]">▾</span>
          </button>
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Tasks
          </span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-[var(--color-user)]/15 text-[var(--color-user)]">
              {activeCount}
            </span>
          )}
          {isLoading && (
            <span className="w-2 h-2 rounded-full bg-[var(--color-agent)] animate-pulse" />
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          disabled={isLoading}
          title="Refresh tasks"
          className="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isLoading ? 'animate-spin' : ''}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      {/* Content - scrollable */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {error && !todos.length && (
          <p className="px-1.5 py-1 text-[10px] text-[var(--color-text-faint)] italic">
            Unable to load tasks
          </p>
        )}
        {!error && todos.length === 0 && !isLoading && (
          <p className="px-1.5 py-1 text-[10px] text-[var(--color-text-faint)] italic">
            No tasks yet
          </p>
        )}
        {sortedTodos.length > 0 && (
          <div className="space-y-0.5">
            {sortedTodos.map((todo, index) => (
              <TodoItem key={`${todo.content}-${index}`} todo={todo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default TodoList;
