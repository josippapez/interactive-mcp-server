/**
 * Fetch todos for a specific OpenCode session.
 *
 * Uses the OpenCode SDK to retrieve the current task list for the agent session.
 */

import { sessionTodo } from './session-api';

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

/**
 * Fetch todos for a given OpenCode session ID.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @param sessionId - The OpenCode session ID to fetch todos for
 * @returns Array of Todo items, or null if the request fails
 */
export async function fetchTodosForSession(
  openCodePort: number,
  sessionId: string,
): Promise<Todo[] | null> {
  try {
    const response = await sessionTodo(openCodePort, sessionId, {
      signal: AbortSignal.timeout(3000),
    });

    if (response.error) {
      console.warn(
        `[opencode-todo] SDK error for session ${sessionId}:`,
        response.error,
      );
      return null;
    }

    const httpResponse = response.response;
    if (httpResponse && !httpResponse.ok) {
      console.warn(
        `[opencode-todo] HTTP error ${httpResponse.status} for session ${sessionId}`,
      );
      return null;
    }

    const data = response.data;
    if (!Array.isArray(data)) {
      console.warn(
        `[opencode-todo] Invalid response format for session ${sessionId}`,
      );
      return null;
    }

    // Validate and normalize the todo items
    return data.map((item) => ({
      content: typeof item.content === 'string' ? item.content : '',
      status: isValidStatus(item.status) ? item.status : 'pending',
      priority: isValidPriority(item.priority) ? item.priority : 'medium',
    }));
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      console.warn(`[opencode-todo] Error fetching todos:`, err);
    }
    return null;
  }
}

function isValidStatus(
  value: unknown,
): value is 'pending' | 'in_progress' | 'completed' | 'cancelled' {
  return (
    value === 'pending' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'cancelled'
  );
}

function isValidPriority(value: unknown): value is 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low';
}
