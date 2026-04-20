import { useCallback, useEffect, useRef, useState } from 'react';

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

const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds (fallback when SSE unavailable)

/**
 * Hook to fetch and manage todos for a specific OpenCode session.
 *
 * Listens for real-time SSE events (todo.updated) from the OpenCode server
 * and falls back to polling every 5 seconds if SSE is unavailable.
 *
 * @param sessionId - The OpenCode session ID to fetch todos for, or null if none selected
 * @returns Object containing todos array, loading state, error, and refresh function
 */
export function useTodos(sessionId: string | null): UseTodosResult {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  const hasReceivedSseRef = useRef(false);
  sessionIdRef.current = sessionId;

  const fetchTodos = useCallback(async (): Promise<void> => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      setTodos([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.api.fetchSessionTodos?.(currentSessionId);
      // Only update state if the session ID hasn't changed while we were fetching
      if (sessionIdRef.current !== currentSessionId) return;

      if (result?.todos) {
        setTodos(result.todos);
        setError(null);
      } else {
        setTodos([]);
        setError(result?.error ?? 'Failed to fetch todos');
      }
    } catch (err) {
      if (sessionIdRef.current !== currentSessionId) return;
      setTodos([]);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (sessionIdRef.current === currentSessionId) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch todos when session ID changes (deferred to idle time)
  useEffect(() => {
    if (!sessionId) {
      setTodos([]);
      setError(null);
      setIsLoading(false);
      hasReceivedSseRef.current = false;
      return;
    }

    // Defer non-critical fetch to idle time to prioritize conversation rendering
    const idleCallback =
      'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 50);

    const handle = idleCallback(() => {
      void fetchTodos();
    });

    return () => {
      if ('cancelIdleCallback' in window && typeof handle === 'number') {
        window.cancelIdleCallback(handle);
      }
    };
  }, [sessionId, fetchTodos]);

  // Set up polling for todo updates (fallback when SSE is unavailable)
  useEffect(() => {
    if (!sessionId) return;

    const intervalId = setInterval(() => {
      // Skip polling if we've received SSE events (SSE is working)
      if (hasReceivedSseRef.current) return;
      void fetchTodos();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [sessionId, fetchTodos]);

  // Listen for todo update events from main process (legacy IPC)
  useEffect(() => {
    const handler = (data: { sessionId: string; todos: Todo[] }) => {
      if (data.sessionId === sessionIdRef.current) {
        setTodos(data.todos);
        setError(null);
      }
    };

    const dispose = window.api.onTodosUpdated?.(handler);

    return () => {
      dispose?.();
    };
  }, []);

  // Listen for real-time SSE todo updates (todo.updated event)
  useEffect(() => {
    const handler = (data: {
      sessionID: string;
      todos: {
        id: string;
        content: string;
        status: string;
        priority: string;
      }[];
    }) => {
      if (data.sessionID === sessionIdRef.current) {
        hasReceivedSseRef.current = true;
        // Transform SSE todos to match our Todo type
        const transformedTodos: Todo[] = data.todos.map((t) => ({
          content: t.content,
          status: t.status as Todo['status'],
          priority: t.priority as Todo['priority'],
        }));
        setTodos(transformedTodos);
        setError(null);
      }
    };

    const dispose = window.api.onOpenCodeTodoUpdated?.(handler);

    return () => {
      dispose?.();
    };
  }, []);

  return {
    todos,
    isLoading,
    error,
    refresh: fetchTodos,
  };
}
