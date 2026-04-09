import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const { capturedApp } = vi.hoisted(() => ({
  capturedApp: { current: null as unknown | null },
}));

vi.mock('express', async (importOriginal) => {
  const mod = await importOriginal<{ default: typeof import('express') }>();
  const originalFactory = mod.default;
  function wrappedExpress(
    ...args: Parameters<typeof originalFactory>
  ): ReturnType<typeof originalFactory> {
    const app = originalFactory(...args);
    const origListen = app.listen.bind(app);
    app.listen = function (...listenArgs: unknown[]) {
      capturedApp.current = app;
      return origListen(...listenArgs) as ReturnType<typeof app.listen>;
    } as typeof app.listen;
    return app;
  }
  Object.assign(wrappedExpress, originalFactory);
  return { default: wrappedExpress as unknown as typeof originalFactory };
});

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
    listenerCount: vi.fn(() => 0),
  },
  shell: { beep: vi.fn() },
}));
vi.mock('./database', () => ({
  saveConversation: vi.fn(),
  appendSessionChannelMessage: vi.fn(),
  createSessionChannel: vi.fn(),
  deleteSessionChannel: vi.fn(),
  getAllRegisteredConnections: vi.fn(() => []),
  upsertRegisteredConnection: vi.fn(),
  isOpenCodeSessionClaimed: vi.fn(() => false),
}));
vi.mock('./session-file', () => ({
  writeSessionFile: vi.fn(),
  clearSessionFile: vi.fn(),
  writeMcpConfigHint: vi.fn(),
  MCP_CONFIG_FILE: '/tmp/x',
}));
vi.mock('./attachment-store', () => ({ cleanupOldAttachments: vi.fn() }));
vi.mock('./session-registration-cleanup', () => ({
  pickUnregisteredConnectionsForCleanup: vi.fn(() => []),
}));
vi.mock('./opencode-session', () => ({
  autoDetectOpenCodeSession: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('./session-tree-manager', () => ({
  triggerSessionTreeUpdate: vi.fn(),
}));
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
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      tool: vi.fn(),
    };
  }),
}));
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: vi.fn(() => true),
  LATEST_PROTOCOL_VERSION: '2024-11-05',
}));
vi.mock('./api-routes', () => ({
  createApiRouter: vi.fn(() => {
    function m(_r: unknown, _s: unknown, n: () => void) {
      n();
    }
    return m;
  }),
}));
vi.mock('./ipc-prompt', () => ({
  cancelActivePrompt: vi.fn(),
  promptUser: vi.fn(),
  setSoundEnabled: vi.fn(),
  setPromptTimeout: vi.fn(),
  isPromptActive: vi.fn(() => false),
  clearActivePrompt: vi.fn(),
}));

const { lastTransportRef } = vi.hoisted(() => ({
  lastTransportRef: { current: null as null | { sessionId: string } },
}));
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function (
    this: unknown,
    {
      sessionIdGenerator,
      onsessioninitialized,
    }: {
      sessionIdGenerator?: () => string;
      onsessioninitialized?: (id: string) => void;
    },
  ) {
    const sessionId = sessionIdGenerator?.() ?? 'fallback-id';
    console.log('[Transport] constructor called, sessionId:', sessionId);
    const t = {
      sessionId,
      handleRequest: vi.fn(() => {
        console.log('[Transport.handleRequest] called');
        return Promise.resolve();
      }),
      close: vi.fn(() => Promise.resolve()),
      onclose: null,
    };
    lastTransportRef.current = t;
    queueMicrotask(() => {
      console.log('[Transport] firing onsessioninitialized');
      onsessioninitialized?.(sessionId);
    });
    return t;
  }),
}));

import express from 'express';
import { startMcpServer, stopMcpServer } from './mcp-server';
import { cancelActivePrompt } from './ipc-prompt';

describe('debug5 — full flow', () => {
  beforeEach(async () => {
    capturedApp.current = null;
    lastTransportRef.current = null;
    await startMcpServer(
      3095,
      () => null,
      () => false,
      () => 200_000,
      () => 4096,
      () => false,
      () => 'standalone',
    );
  });
  afterEach(() => stopMcpServer());

  it('registers socket close listener after GET /mcp', async () => {
    const app = capturedApp.current as express.Express;
    expect(app).toBeTruthy();

    // POST
    const postReq = {
      method: 'POST',
      url: '/mcp',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      httpVersion: '1.1',
      originalUrl: '/mcp',
      ip: '127.0.0.1',
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

    app(postReq, postRes, (err?: Error) => {
      if (err) console.log('[POST next with error]', err.message);
      else console.log('[POST next without error]');
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const sessionId = lastTransportRef.current?.sessionId;
    console.log('[test] sessionId:', sessionId);
    expect(sessionId).toBeTruthy();

    // GET
    const socket = new EventEmitter();
    socket.on('error', () => {});
    const res = Object.assign(new EventEmitter(), {
      write: vi.fn(() => true),
      end: vi.fn(),
      writableEnded: false,
      headersSent: false,
      socket,
      setHeader: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      writeHead: vi.fn().mockReturnThis(),
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    });
    const getReq = {
      method: 'GET',
      url: '/mcp',
      headers: { 'mcp-session-id': sessionId },
      socket,
      httpVersion: '1.1',
      originalUrl: '/mcp',
      ip: '127.0.0.1',
    } as unknown as express.Request;

    app(getReq, res as unknown as express.Response, (err?: Error) => {
      if (err) console.log('[GET next with error]', err.message);
      else console.log('[GET next without error — probably 404?]');
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    console.log('[test] socket listeners count:', socket.eventNames());
    console.log('[test] res listeners count:', res.eventNames());

    socket.emit('close');
    for (let i = 0; i < 5; i++) await Promise.resolve();

    console.log(
      '[test] cancelActivePrompt calls:',
      vi.mocked(cancelActivePrompt).mock.calls.length,
    );
    expect(cancelActivePrompt).toHaveBeenCalled();
  });
});
