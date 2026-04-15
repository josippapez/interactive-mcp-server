import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTodosForSession, Todo } from './todo';

describe('fetchTodosForSession', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockFetch.mockRejectedValue(new Error('Unexpected unmocked fetch call'));
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns todos on successful response', async () => {
    const mockTodos: Todo[] = [
      { content: 'Task 1', status: 'pending', priority: 'high' },
      { content: 'Task 2', status: 'completed', priority: 'low' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTodos),
    } as Response);

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toEqual(mockTodos);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4096/session/session-123/todo',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns null on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toBeNull();
  });

  it('falls back to default port when configured port fails', async () => {
    const mockTodos: Todo[] = [
      { content: 'Task 1', status: 'pending', priority: 'high' },
    ];

    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTodos),
      } as Response);

    const result = await fetchTodosForSession(5000, 'session-123');

    expect(result).toEqual(mockTodos);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:5000/session/session-123/todo',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4096/session/session-123/todo',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('normalizes invalid todo status to pending', async () => {
    const invalidTodo = {
      content: 'Task',
      status: 'invalid',
      priority: 'high',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([invalidTodo]),
    } as Response);

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toEqual([
      { content: 'Task', status: 'pending', priority: 'high' },
    ]);
  });

  it('normalizes invalid priority to medium', async () => {
    const invalidTodo = {
      content: 'Task',
      status: 'pending',
      priority: 'invalid',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([invalidTodo]),
    } as Response);

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toEqual([
      { content: 'Task', status: 'pending', priority: 'medium' },
    ]);
  });

  it('returns null for non-array response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: 'not an array' }),
    } as Response);

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toBeNull();
  });

  it('handles timeout silently', async () => {
    const abortError = new Error('Timeout');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toBeNull();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles all valid statuses', async () => {
    const todos = [
      { content: 'Pending', status: 'pending', priority: 'low' },
      { content: 'In Progress', status: 'in_progress', priority: 'medium' },
      { content: 'Completed', status: 'completed', priority: 'high' },
      { content: 'Cancelled', status: 'cancelled', priority: 'low' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(todos),
    } as Response);

    const result = await fetchTodosForSession(4096, 'session-123');

    expect(result).toEqual(todos);
  });
});
