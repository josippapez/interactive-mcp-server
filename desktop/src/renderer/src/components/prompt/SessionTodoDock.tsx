import { memo } from 'react';
import type { Todo } from '../../hooks/useTodos';
import {
  getTodoDockSummary,
  getTodoPreview,
  getTodosForDockDisplay,
} from './session-todo-dock-helpers';

type SessionTodoDockProps = {
  todos: Todo[];
  isLoading: boolean;
  error: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onRefresh: () => void;
};

/**
 * 16x16 checkbox-style status indicator, mirroring OpenCode's
 * `[data-component="checkbox"]` control:
 *   - default: weak border, transparent background
 *   - checked/indeterminate: base border, weak surface fill
 *   - completed: small check glyph
 *   - in_progress: 12x12 pulsing dot, matching --animate-pulse-scale
 *   - cancelled: small ✕ glyph at weak opacity
 */
function TodoStatusIcon({ status }: { status: Todo['status'] }) {
  const isActive =
    status === 'completed' ||
    status === 'in_progress' ||
    status === 'cancelled';

  return (
    <span
      data-state={status}
      aria-hidden="true"
      className={[
        'mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        isActive
          ? 'border-[var(--color-border)] bg-[var(--color-surface-alt)]'
          : 'border-[var(--color-border)]/70 bg-transparent',
      ].join(' ')}
    >
      {status === 'completed' && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="block text-[var(--color-text)]"
        >
          <path d="M2.5 6.5 5 9l4.5-5" />
        </svg>
      )}
      {status === 'in_progress' && (
        <svg
          viewBox="0 0 12 12"
          width="12"
          height="12"
          xmlns="http://www.w3.org/2000/svg"
          className="block"
        >
          <circle
            cx="6"
            cy="6"
            r="3"
            fill="currentColor"
            className="text-[var(--color-text)]"
            style={{
              animation: 'todoDockPulseScale 1.2s ease-in-out infinite',
              transformOrigin: 'center',
              transformBox: 'fill-box',
            }}
          />
        </svg>
      )}
      {status === 'cancelled' && (
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="block text-[var(--color-text-muted)]"
        >
          <path d="m3 3 6 6M9 3l-6 6" />
        </svg>
      )}
    </span>
  );
}

function SessionTodoDock({
  todos,
  isLoading,
  error,
  collapsed,
  onToggle,
  onRefresh,
}: SessionTodoDockProps): React.ReactElement | null {
  if (todos.length === 0 && !isLoading && !error) {
    return null;
  }

  const displayedTodos = getTodosForDockDisplay(todos);
  const { completedCount, totalCount } = getTodoDockSummary(todos);
  const preview = getTodoPreview(todos);

  return (
    <section
      data-component="session-todo-dock"
      aria-label="Session tasks"
      className="group/dock mx-auto w-full max-w-3xl overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
    >
      {/* Local keyframes so we don't depend on a global --animate-pulse-scale */}
      <style>{`
        @keyframes todoDockPulseScale {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.6); opacity: 0.55; }
        }
      `}</style>

      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls="session-todo-dock-list"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onToggle();
        }}
        className="flex items-center gap-2 overflow-visible py-2 pl-3 pr-2 cursor-default select-none"
        data-action="session-todo-toggle"
      >
        <span
          className="shrink-0 whitespace-pre text-[14px] font-normal leading-normal tabular-nums text-[var(--color-text)]"
          aria-label={`${completedCount} of ${totalCount} tasks complete`}
        >
          {completedCount}/{totalCount} tasks
        </span>

        {isLoading && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-agent)] animate-pulse"
            aria-label="Loading tasks"
          />
        )}

        <div
          data-slot="session-todo-preview"
          className="ml-1 min-w-0 flex-1 overflow-hidden"
        >
          {collapsed && preview && (
            <span className="block truncate text-[14px] font-normal leading-normal text-[var(--color-text-muted)]">
              {preview}
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRefresh();
            }}
            disabled={isLoading}
            className="rounded-md p-1 text-[var(--color-text-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)] disabled:opacity-30 group-hover/dock:opacity-100 focus-visible:opacity-100"
            aria-label="Refresh tasks"
            title="Refresh tasks"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isLoading ? 'animate-spin' : ''}
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>

          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            data-collapsed={collapsed ? 'true' : 'false'}
            className="rounded-md p-1 text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
            aria-label={collapsed ? 'Expand tasks' : 'Collapse tasks'}
            title={collapsed ? 'Expand tasks' : 'Collapse tasks'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: `rotate(${collapsed ? 0 : 180}deg)`,
                transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              aria-hidden="true"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>

      <div
        id="session-todo-dock-list"
        data-slot="session-todo-list"
        aria-hidden={collapsed}
        className={[
          'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
          collapsed
            ? 'max-h-0 opacity-0 pointer-events-none'
            : 'max-h-[10.5rem] opacity-100',
        ].join(' ')}
      >
        <div className="max-h-[10.5rem] overflow-y-auto px-3 pb-3">
          {error && todos.length === 0 && (
            <p className="py-1 text-[13px] italic text-[var(--color-text-faint)]">
              Unable to load tasks
            </p>
          )}
          {displayedTodos.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {displayedTodos.map((todo, index) => {
                const done =
                  todo.status === 'completed' || todo.status === 'cancelled';
                return (
                  <li
                    key={`${todo.content}-${index}`}
                    data-state={todo.status}
                    className="flex items-start gap-3"
                    style={{
                      opacity: todo.status === 'pending' ? 0.94 : 1,
                      transition:
                        'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    <TodoStatusIcon status={todo.status} />
                    <span
                      className="min-w-0 flex-1 break-words text-[14px] font-normal leading-normal"
                      style={{
                        color: done
                          ? 'var(--color-text-muted)'
                          : 'var(--color-text)',
                        textDecoration: done ? 'line-through' : 'none',
                        textDecorationColor:
                          'color-mix(in srgb, var(--color-text-faint) 70%, transparent)',
                        transition:
                          'color 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    >
                      {todo.content}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default memo(SessionTodoDock);
