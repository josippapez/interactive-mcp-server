import type { Todo } from '../../hooks/useTodos';

export function getTodosForDockDisplay(todos: readonly Todo[]): Todo[] {
  return [...todos];
}

export function getTodoDockSummary(todos: readonly Todo[]): {
  completedCount: number;
  totalCount: number;
  activeCount: number;
} {
  return {
    completedCount: todos.filter((todo) => todo.status === 'completed').length,
    totalCount: todos.length,
    activeCount: todos.filter(
      (todo) => todo.status === 'pending' || todo.status === 'in_progress',
    ).length,
  };
}

export function getTodoPreview(todos: readonly Todo[]): string {
  return (
    (
      todos.find((todo) => todo.status === 'in_progress') ??
      todos.find((todo) => todo.status === 'pending') ??
      todos.filter((todo) => todo.status === 'completed').at(-1) ??
      todos[0]
    )?.content ?? ''
  );
}
