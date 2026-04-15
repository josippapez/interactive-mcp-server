import { memo } from 'react';
import type { Todo } from '../../hooks/useTodos';
import TodoList from './TodoList';

type TasksSidebarProps = {
  /** List of todo items to display */
  todos: Todo[];
  /** Whether todos are loading */
  isLoading: boolean;
  /** Error message if todos failed to load */
  error: string | null;
  /** Callback to refresh todos */
  onRefresh: () => void;
  /** Whether the sidebar is collapsed */
  collapsed: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed: () => void;
};

/**
 * Collapsible right sidebar displaying the todo list for OpenCode sessions.
 */
function TasksSidebar({
  todos,
  isLoading,
  error,
  onRefresh,
  collapsed,
  onToggleCollapsed,
}: TasksSidebarProps): React.ReactElement {
  const activeTodoCount = todos.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  ).length;

  return (
    <div
      className={`border-l border-[var(--color-border)] bg-[var(--color-surface-alt)] flex flex-col overflow-hidden shrink-0 transition-[width] duration-200 ease-in-out ${
        collapsed ? 'w-8' : 'w-72'
      }`}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex flex-col items-center gap-2 py-3 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors h-full"
          title="Expand tasks panel"
        >
          <span className="text-[10px]">◀</span>
          <span
            className="text-[9px] font-medium uppercase tracking-wide"
            style={{ writingMode: 'vertical-rl' }}
          >
            Tasks
          </span>
          {activeTodoCount > 0 && (
            <span className="px-1 py-0.5 rounded-full bg-[var(--color-surface-alt)] text-[8px] text-[var(--color-user)]">
              {activeTodoCount}
            </span>
          )}
        </button>
      ) : (
        <>
          {/* Collapse button in header area */}
          <div className="flex items-center justify-end px-2 py-1 border-b border-[var(--color-border)]">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors"
              title="Collapse tasks panel"
            >
              <span className="text-[10px]">▶</span>
            </button>
          </div>
          <TodoList
            todos={todos}
            isLoading={isLoading}
            error={error}
            onRefresh={onRefresh}
          />
        </>
      )}
    </div>
  );
}

export default memo(TasksSidebar);
