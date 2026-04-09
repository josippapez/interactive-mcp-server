/**
 * mcp-server.test.ts
 *
 * Tests for the SSE keepalive + dead-stream detection logic added to the
 * GET /mcp handler in mcp-server.ts.
 *
 * Strategy: Mock express so the factory returns a real express app instance
 * but with `listen` stubbed (to avoid binding a port). We capture that app
 * instance using vi.hoisted() and drive GET /mcp routes directly.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { EventEmitter } from 'events';

// ── Hoist shared mutable state so vi.mock factories can reference it ─────────
const { capturedApp, lastTransport } = vi.hoisted(() => ({
  capturedApp: { current: null as unknown | null },
  lastTransport: {
    current: null as null | { sessionId: string; handleRequest: Mock },
  },
}));

// ── Mock express so we capture the app without binding a port ────────────────
vi.mock('express', async (importOriginal) => {
  // importOriginal returns the module namespace; the factory function is .default
  const mod = await importOriginal<{ default: typeof import('express') }>();
  const originalFactory = mod.default;

  // A minimal stub returned by app.listen() — no real TCP socket.
  const serverStub = {
    keepAliveTimeout: 0,
    headersTimeout: 0,
    closeAllConnections: () => {},
    close: (_cb?: () => void) => {
      _cb?.();
    },
  };

  // Wrap the express factory: capture the created app and stub listen.
  function wrappedExpress(
    ...args: Parameters<typeof originalFactory>
  ): ReturnType<typeof originalFactory> {
    const app = originalFactory(...args);
    // Replace listen with a stub that captures the app but never binds a port.
    app.listen = function (..._listenArgs: unknown[]) {
      capturedApp.current = app;
      return serverStub as unknown as ReturnType<typeof app.listen>;
    } as typeof app.listen;
    return app;
  }

  // Copy all static properties (Router, json, urlencoded, …) from originalFactory.
  Object.assign(wrappedExpress, originalFactory);

  // Return ONLY default — spreading ...mod would overwrite default with the
  // original factory, defeating the purpose of the mock.
  return {
    default: wrappedExpress as unknown as typeof originalFactory,
  };
});

// ── Mock Electron ─────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
    listenerCount: vi.fn(() => 0),
  },
  shell: { beep: vi.fn() },
}));

// ── Mock database ─────────────────────────────────────────────────────────────
vi.mock('./database', () => ({
  saveConversation: vi.fn(),
  appendSessionChannelMessage: vi.fn(),
  createSessionChannel: vi.fn(),
  deleteSessionChannel: vi.fn(),
  getAllRegisteredConnections: vi.fn(() => []),
  upsertRegisteredConnection: vi.fn(),
  isOpenCodeSessionClaimed: vi.fn(() => false),
}));

// ── Mock session-file ─────────────────────────────────────────────────────────
vi.mock('./session-file', () => ({
  writeSessionFile: vi.fn(),
  clearSessionFile: vi.fn(),
  writeMcpConfigHint: vi.fn(),
  MCP_CONFIG_FILE: '/tmp/mcp-config-hint.json',
}));

// ── Mock attachment-store ─────────────────────────────────────────────────────
vi.mock('./attachment-store', () => ({
  cleanupOldAttachments: vi.fn(),
}));

// ── Mock session-registration-cleanup ────────────────────────────────────────
vi.mock('./session-registration-cleanup', () => ({
  pickUnregisteredConnectionsForCleanup: vi.fn(() => []),
}));

// ── Mock opencode-session ─────────────────────────────────────────────────────
vi.mock('./opencode-session', () => ({
  autoDetectOpenCodeSession: vi.fn(() => Promise.resolve(null)),
}));

// ── Mock session-tree-manager ─────────────────────────────────────────────────
vi.mock('./session-tree-manager', () => ({
  triggerSessionTreeUpdate: vi.fn(),
}));

// ── Mock tools ────────────────────────────────────────────────────────────────
vi.mock('./tools/request-user-input', () => ({
  registerRequestUserInput: vi.fn(),
}));
vi.mock('./tools/intensive-chat', () => ({
  registerIntensiveChatTools: vi.fn(),
}));
vi.mock('./tools/session-channel', () => ({
  registerSessionChannelTools: vi.fn(),
  registerSendMessageTool: vi.fn(),
}));
vi.mock('./tools/register-connection', () => ({
  registerConnectionTool: vi.fn(),
}));
vi.mock('./tools/find-repo-docs', () => ({
  registerFindRepoDocsTool: vi.fn(),
}));
vi.mock('./tools/manage-skills-and-instructions', () => ({
  registerManageSkillsAndInstructionsTool: vi.fn(),
}));

// ── Mock MCP SDK ──────────────────────────────────────────────────────────────
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      tool: vi.fn(),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function ({
    sessionIdGenerator,
    onsessioninitialized,
  }: {
    sessionIdGenerator?: () => string;
    onsessioninitialized?: (id: string) => void;
  }) {
    // Use the real sessionIdGenerator so the session is stored under the
    // same ID that the GET /mcp handler will look up.
    const sessionId = sessionIdGenerator?.() ?? 'test-session-id';
    const t = {
      sessionId,
      handleRequest: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      onclose: null as (() => void) | null,
    };
    // Track the most recent transport instance so tests can read sessionId.
    lastTransport.current = t;
    // Fire asynchronously — the `const transport = new ...` assignment in
    // mcp-server.ts must complete before onsessioninitialized references
    // `transport` (declared with const) or we hit a TDZ ReferenceError.
    queueMicrotask(() => onsessioninitialized?.(sessionId));
    return t;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: vi.fn(() => true),
  LATEST_PROTOCOL_VERSION: '2024-11-05',
}));

// ── Mock api-routes ───────────────────────────────────────────────────────────
vi.mock('./api-routes', () => ({
  createApiRouter: vi.fn(() => {
    // Must be a plain middleware function so express app.use() accepts it.
    function apiRouterMiddleware(
      _req: unknown,
      _res: unknown,
      next: () => void,
    ): void {
      next();
    }
    return apiRouterMiddleware;
  }),
}));

// ── Mock ipc-prompt ───────────────────────────────────────────────────────────
vi.mock('./ipc-prompt', () => ({
  cancelActivePrompt: vi.fn(),
  promptUser: vi.fn(),
  setSoundEnabled: vi.fn(),
  setPromptTimeout: vi.fn(),
  isPromptActive: vi.fn(() => false),
  clearActivePrompt: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after all vi.mock declarations)
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import { startMcpServer, stopMcpServer } from './mcp-server';
import { cancelActivePrompt } from './ipc-prompt';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal fake SSE socket + response pair that satisfies express
 * internal requirements and lets us simulate socket events.
 */
function makeFakeSseReqRes(sessionId: string) {
  const socket = new EventEmitter() as EventEmitter & {
    removeListener: Mock;
  };
  // Prevent unhandled 'error' events from throwing in tests.
  socket.on('error', () => {});
  socket.removeListener = vi.fn(
    (...args: Parameters<typeof socket.removeListener>) =>
      EventEmitter.prototype.removeListener.call(socket, ...args),
  ) as Mock;

  const res = new EventEmitter() as EventEmitter & {
    write: Mock;
    end: Mock;
    writableEnded: boolean;
    headersSent: boolean;
    socket: typeof socket;
    setHeader: Mock;
    getHeader: Mock;
    removeHeader: Mock;
    writeHead: Mock;
    statusCode: number;
    status: Mock;
    json: Mock;
  };
  res.write = vi.fn(() => true);
  res.end = vi.fn();
  res.writableEnded = false;
  res.headersSent = false;
  res.socket = socket;
  res.setHeader = vi.fn().mockReturnThis();
  res.getHeader = vi.fn();
  res.removeHeader = vi.fn();
  res.writeHead = vi.fn().mockReturnThis();
  res.statusCode = 200;
  res.status = vi.fn().mockReturnThis();
  res.json = vi.fn();

  const req = {
    method: 'GET',
    url: '/mcp',
    headers: { 'mcp-session-id': sessionId },
    socket,
    httpVersion: '1.1',
    originalUrl: '/mcp',
    ip: '127.0.0.1',
  } as unknown as express.Request;

  return { req, res, socket };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /mcp — dead-stream detection', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    capturedApp.current = null;
    lastTransport.current = null;

    await startMcpServer(
      3099,
      () => null,
      () => false,
      () => 200_000,
      () => 4096,
      () => false,
      () => 'standalone',
    );
  });

  afterEach(() => {
    stopMcpServer();
    vi.useRealTimers();
    vi.mocked(cancelActivePrompt).mockReset();
    lastTransport.current = null;
  });

  /**
   * Register a session via POST /mcp, then start an SSE stream via GET /mcp.
   * Returns the fake res and socket so callers can simulate socket events.
   */
  async function openSseStream(): Promise<{
    res: ReturnType<typeof makeFakeSseReqRes>['res'];
    socket: ReturnType<typeof makeFakeSseReqRes>['socket'];
  }> {
    const app = capturedApp.current as express.Express;
    expect(
      app,
      'express app should be captured after startMcpServer',
    ).toBeTruthy();

    // 1) POST /mcp — register the session.
    //    The transport mock calls onsessioninitialized via queueMicrotask so
    //    it fires after the `const transport = ...` assignment completes.
    const postReq = {
      method: 'POST',
      url: '/mcp',
      headers: {},
      httpVersion: '1.1',
      originalUrl: '/mcp',
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {},
        },
      },
    } as unknown as express.Request;

    const postRes = {
      setHeader: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      writeHead: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      end: vi.fn(),
      write: vi.fn(() => true),
      headersSent: false,
      writableEnded: false,
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      statusCode: 200,
    } as unknown as express.Response;

    // Drive the POST route.
    app(postReq, postRes, () => {});

    // Let queueMicrotask (onsessioninitialized) + server.connect() +
    // transport.handleRequest() all settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Read the session ID from the transport mock instance set in the factory.
    const sessionId = lastTransport.current?.sessionId ?? 'test-session-id';

    // 2) GET /mcp — open the SSE stream using the real session ID.
    const { req: getReq, res: getRes, socket } = makeFakeSseReqRes(sessionId);

    // Fire GET — don't await, SSE streams are long-lived.
    app(getReq, getRes as unknown as express.Response, () => {
      /* no-op next */
    });

    // Give the async GET handler time to await transport.handleRequest and
    // register the socket listeners.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    return { res: getRes, socket };
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('calls cancelActivePrompt when the SSE socket emits close', async () => {
    const { socket } = await openSseStream();

    // Simulate OS killing the TCP connection.
    socket.emit('close');

    await Promise.resolve();

    expect(cancelActivePrompt).toHaveBeenCalledWith(expect.any(String));
  });

  it('calls cancelActivePrompt when the SSE socket emits error', async () => {
    const { socket } = await openSseStream();

    socket.emit('error', new Error('ECONNRESET'));

    await Promise.resolve();

    expect(cancelActivePrompt).toHaveBeenCalledWith(expect.any(String));
  });

  it('does NOT call cancelActivePrompt after res close removes socket listeners', async () => {
    const { res, socket } = await openSseStream();

    // Simulate a clean response close — this should remove the socket listeners.
    res.emit('close');

    // Now socket close fires — the listener should already be removed.
    socket.emit('close');

    await Promise.resolve();

    // cancelActivePrompt should NOT have been called because the res 'close'
    // event removed the socket listeners before socket.close fired.
    expect(cancelActivePrompt).not.toHaveBeenCalled();
  });

  it('writes keepalive SSE comments every 15 seconds', async () => {
    const { res } = await openSseStream();

    // Advance 15 s — one keepalive write expected.
    vi.advanceTimersByTime(15_000);
    expect(res.write).toHaveBeenCalledWith(': keepalive\n\n');

    // Advance another 15 s — second keepalive.
    vi.advanceTimersByTime(15_000);
    expect(res.write).toHaveBeenCalledTimes(2);
  });

  it('stops writing keepalive after res is ended (writableEnded = true)', async () => {
    const { res } = await openSseStream();

    // Mark the response as ended.
    res.writableEnded = true;

    // Advance past the interval — write should NOT be called.
    vi.advanceTimersByTime(15_000);
    expect(res.write).not.toHaveBeenCalled();
  });
});
