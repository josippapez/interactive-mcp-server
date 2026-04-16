import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { fetchTodosForSession, Todo } from './todo';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

// ---------------------------------------------------------------------------
// Test HTTP server that simulates the OpenCode /session/:id/todo endpoint
// ---------------------------------------------------------------------------

let server: http.Server;
let serverPort: number;
let responseData: unknown = [];
let responseStatus = 200;

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      }
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

// Create a mock SDK client that makes HTTP requests to our test server
function createMockClient(port: number) {
  return {
    session: {
      todo: async (opts: { path: { id: string }; signal?: AbortSignal }) => {
        try {
          const res = await fetch(
            `http://127.0.0.1:${port}/session/${opts.path.id}/todo`,
            { signal: opts.signal },
          );
          const data = await res.json();
          return {
            data,
            response: res,
            error: res.ok ? undefined : 'HTTP error',
          };
        } catch (err) {
          return { data: null, error: String(err) };
        }
      },
    },
  } as any;
}

describe('fetchTodosForSession', () => {
  beforeEach(async () => {
    responseData = [];
    responseStatus = 200;
    serverPort = await startServer();
    // Configure SDK client to use our test server
    _setClientFactory(() => createMockClient(serverPort));
  });

  afterEach(async () => {
    await stopServer();
    _resetClientFactory();
    vi.restoreAllMocks();
  });

  it('returns todos on successful response', async () => {
    const mockTodos: Todo[] = [
      { content: 'Task 1', status: 'pending', priority: 'high' },
      { content: 'Task 2', status: 'completed', priority: 'low' },
    ];
    responseData = mockTodos;

    const result = await fetchTodosForSession(serverPort, 'session-123');

    expect(result).toEqual(mockTodos);
  });

  it('returns null on HTTP error', async () => {
    responseStatus = 404;
    responseData = { error: 'not found' };

    const result = await fetchTodosForSession(serverPort, 'session-123');

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    await stopServer();
    // Configure to use a non-existent port
    _setClientFactory(() => createMockClient(1));

    const result = await fetchTodosForSession(1, 'session-123');

    expect(result).toBeNull();
  });

  it('normalizes invalid todo status to pending', async () => {
    responseData = [
      {
        content: 'Task',
        status: 'invalid',
        priority: 'high',
      },
    ];

    const result = await fetchTodosForSession(serverPort, 'session-123');

    expect(result).toEqual([
      { content: 'Task', status: 'pending', priority: 'high' },
    ]);
  });

  it('normalizes invalid priority to medium', async () => {
    responseData = [
      {
        content: 'Task',
        status: 'pending',
        priority: 'invalid',
      },
    ];

    const result = await fetchTodosForSession(serverPort, 'session-123');

    expect(result).toEqual([
      { content: 'Task', status: 'pending', priority: 'medium' },
    ]);
  });

  it('returns null for non-array response', async () => {
    responseData = { error: 'not an array' };

    const result = await fetchTodosForSession(serverPort, 'session-123');

    expect(result).toBeNull();
  });

  it('handles all valid statuses', async () => {
    const todos = [
      { content: 'Pending', status: 'pending', priority: 'low' },
      { content: 'In Progress', status: 'in_progress', priority: 'medium' },
      { content: 'Completed', status: 'completed', priority: 'high' },
      { content: 'Cancelled', status: 'cancelled', priority: 'low' },
    ];
    responseData = todos;

    const result = await fetchTodosForSession(serverPort, 'session-123');

    expect(result).toEqual(todos);
  });
});
