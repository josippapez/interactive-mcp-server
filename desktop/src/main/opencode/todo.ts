/**
 * Fetch todos for a specific OpenCode session.
 *
 * Uses the OpenCode HTTP API at GET /session/:id/todo to retrieve the
 * current task list for the agent session.
 */

import {
  buildOpenCodePortCandidates,
  fetchFirstSuccessfulJson,
} from './endpoints';

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
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const response = await fetchFirstSuccessfulJson<unknown>(
      ports,
      `/session/${sessionId}/todo`,
      3000,
    );
    if (!response) return null;
    const data = response.data;
    if (!Array.isArray(data)) {
      console.warn(
        `[opencode-todo] Invalid response format for session ${sessionId}`,
      );
      return null;
    }

    // Validate and normalize the todo items
    return data.map((item: unknown) => {
      const raw = item as Record<string, unknown>;
      return {
        content: typeof raw.content === 'string' ? raw.content : '',
        status: isValidStatus(raw.status) ? raw.status : 'pending',
        priority: isValidPriority(raw.priority) ? raw.priority : 'medium',
      };
    });
  } catch (err) {
    // Don't log AbortError (timeout) as it's expected when server is unavailable
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
