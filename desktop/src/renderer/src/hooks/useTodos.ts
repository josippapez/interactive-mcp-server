import { useCallback, useEffect, useRef, useState } from 'react';
import {
  seedTodosForSession,
  useConversationSelector,
} from '../store/conversation-store';

export type Todo = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
};

type UseTodosResult = {
  todos: Todo[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const EMPTY_TODOS: Todo[] = [];

/**
 * Hook exposing the todo list for a specific OpenCode session. Updates flow
 * through the single `conversation-batch` pipeline (`todo.updated` event).
 * On mount (and whenever `sessionId` changes) we perform a one-shot REST
 * seed via `fetchSessionTodos` so the UI has content before the first
 * live event arrives.
 *
 * The previous IPC subscriptions (`onTodosUpdated`,
 * `onOpenCodeTodoUpdated`, `onOpenCodeSessionIdle`) have been removed
 * — their work is now done by the main-side event bridge.
 */
export function useTodos(sessionId: string | null): UseTodosResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const storeTodos = useConversationSelector((state) =>
    sessionId ? (state.todos[sessionId] ?? EMPTY_TODOS) : EMPTY_TODOS,
  );

  // The store carries `ConversationTodoItem` (includes `id`); the external
  // surface of this hook has never exposed `id`. Strip it at the selector
  // boundary so downstream widgets keep the same shape.
  const todos: Todo[] = storeTodos.map((t) => ({
    content: t.content,
    status: t.status,
    priority: t.priority,
  }));

  const refresh = useCallback(async (): Promise<void> => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.api.fetchSessionTodos?.(currentSessionId);
      if (sessionIdRef.current !== currentSessionId) return;

      if (result?.todos) {
        // The REST endpoint doesn't return `id` either; synthesize a stable
        // one from the index so binary-search / React keys have something
        // to hold onto until a live `todo.updated` replaces the list.
        seedTodosForSession(
          currentSessionId,
          result.todos.map((t, i) => ({ id: `seed-${i}`, ...t })),
        );
        setError(null);
      } else if (result?.error) {
        setError(result.error);
      }
    } catch (err) {
      if (sessionIdRef.current !== currentSessionId) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (sessionIdRef.current === currentSessionId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setError(null);
      setIsLoading(false);
      return;
    }

    // Defer non-critical fetch to idle time to prioritize conversation rendering.
    const idleCallback =
      'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 50);

    const handle = idleCallback(() => {
      void refresh();
    });

    return () => {
      if ('cancelIdleCallback' in window && typeof handle === 'number') {
        window.cancelIdleCallback(handle);
      }
    };
  }, [sessionId, refresh]);

  return {
    todos,
    isLoading,
    error,
    refresh,
  };
}
