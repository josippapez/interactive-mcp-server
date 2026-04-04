import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { Server } from 'http';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import {
  promptUser,
  setSoundEnabled,
  setPromptTimeout,
  cancelActivePrompt,
} from './ipc-prompt';
import { registerRequestUserInput } from './tools/request-user-input';
import { registerIntensiveChatTools } from './tools/intensive-chat';
import {
  registerSessionChannelTools,
  registerSendMessageTool,
} from './tools/session-channel';
import { registerConnectionTool } from './tools/register-connection';
import { createSessionChannel, deleteSessionChannel } from './database';
import { writeSessionFile, clearSessionFile } from './session-file';
import { createApiRouter } from './api-routes';

let httpServer: Server | null = null;
let _sessionCleanup: ((connectionId: string) => Promise<boolean>) | null = null;

// Stored params for restart support
let _startParams: {
  port: number;
  getWindow: () => BrowserWindow | null;
  getSoundEnabled: () => boolean;
  getPromptTimeoutMs: () => number;
  getOpenCodePort: () => number;
} | null = null;

/** Create a fresh McpServer with all tools registered (one per connection). */
function createMcpServerWithTools(
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  connectionName: string,
  getOpenCodePort: () => number,
): McpServer {
  const server = new McpServer(
    { name: 'Interactive MCP Desktop', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  registerRequestUserInput(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
  );
  registerIntensiveChatTools(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
  );
  registerSessionChannelTools(server, getWindow, connectionId);
  registerSendMessageTool(server, getWindow, connectionId);
  registerConnectionTool(server, getWindow, connectionId, getOpenCodePort);
  return server;
}

export async function startMcpServer(
  port: number,
  getWindow: () => BrowserWindow | null,
  getSoundEnabled: () => boolean = () => true,
  getPromptTimeoutMs: () => number = () => 800_000,
  getOpenCodePort: () => number = () => 4096,
): Promise<void> {
  _startParams = {
    port,
    getWindow,
    getSoundEnabled,
    getPromptTimeoutMs,
    getOpenCodePort,
  };
  setSoundEnabled(getSoundEnabled);
  setPromptTimeout(getPromptTimeoutMs);
  const app = express();
  app.use(express.json());

  // ─── Streamable HTTP Transport (one McpServer per session) ───
  const sessions: Record<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
      connectionId: string;
    }
  > = {};
  const findSessionByConnectionId = (connectionId: string): string | null => {
    for (const [sid, entry] of Object.entries(sessions)) {
      if (entry.connectionId === connectionId) return sid;
    }
    return null;
  };

  _sessionCleanup = async (connectionId: string): Promise<boolean> => {
    const sid = findSessionByConnectionId(connectionId);
    if (!sid) return false;
    const session = sessions[sid];
    delete sessions[sid];
    try {
      await session.transport.close();
    } catch {
      // best effort close
    }
    try {
      await session.server.close();
    } catch {
      // best effort close
    }
    return true;
  };
  let connectionCounter = 0;

  /**
   * Transparent session resurrection — when a client sends a tool call with a
   * stale session ID (server restarted, session evicted, etc.), we silently
   * create a new MCP session, run the protocol handshake internally, and then
   * forward the original request so the caller never sees an error.
   */
  async function handleTransparentReinit(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    connectionCounter++;
    const connectionId = randomUUID();
    const connectionName = `Agent ${connectionCounter}`;
    const server = createMcpServerWithTools(
      getWindow,
      connectionId,
      connectionName,
      getOpenCodePort,
    );

    // Factory for a no-op response stub used for synthetic MCP handshake requests.
    // Must satisfy @hono/node-server's requirements (writeHead, removeHeader, etc.)
    // so StreamableHTTPServerTransport does not throw on synthetic requests.
    function createNoopResponse() {
      const obj = {
        setHeader() {
          return obj;
        },
        getHeader() {
          return undefined;
        },
        getHeaders() {
          return {};
        },
        removeHeader() {},
        writeHead() {
          return obj;
        },
        flushHeaders() {},
        status() {
          return obj;
        },
        json() {},
        end() {
          return obj;
        },
        write() {
          return true;
        },
        destroy() {},
        on() {
          return obj;
        },
        once() {
          return obj;
        },
        off() {
          return obj;
        },
        emit() {
          return true;
        },
        headersSent: false,
        writableEnded: false,
        writableFinished: false,
      };
      return obj;
    }

    // Create transport and wait for onsessioninitialized to fire.
    let newSessionId: string | undefined;
    const transport = await new Promise<StreamableHTTPServerTransport>(
      (resolve) => {
        const t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            newSessionId = id;
            sessions[id] = { transport: t, server, connectionId };

            createSessionChannel(connectionId, connectionName);
            writeSessionFile(connectionId, port);

            getWindow()?.webContents.send('connection-opened', {
              connectionId,
              name: connectionName,
              sessionId: connectionId,
              label: connectionName,
            });

            resolve(t);
          },
        });

        t.onclose = () => {
          const sid = t.sessionId;
          if (sid && sessions[sid]) {
            const { connectionId: connId } = sessions[sid];
            delete sessions[sid];
            cancelActivePrompt(connId);
            deleteSessionChannel(connId);
            clearSessionFile();
            getWindow()?.webContents.send('connection-closed', {
              connectionId: connId,
            });
            getWindow()?.webContents.send('session-channel-deleted', {
              sessionId: connId,
            });
          }
          server.close().catch(() => {});
        };

        const noopRes = createNoopResponse();

        // Synthetic initialize request body.
        const initBody = {
          jsonrpc: '2.0' as const,
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'cli-reconnect', version: '1.0.0' },
          },
        };

        // Minimal fake request — must satisfy @hono/node-server's newRequest()
        // requirements: rawHeaders array, url, socket stub, and event emitter methods.
        const fakeReq = {
          method: 'POST',
          url: '/mcp',
          headers: { 'content-type': 'application/json' },
          rawHeaders: ['content-type', 'application/json'],
          socket: { encrypted: false, remoteAddress: '127.0.0.1' },
          body: initBody,
          on() {
            return fakeReq;
          },
          once() {
            return fakeReq;
          },
          off() {
            return fakeReq;
          },
          resume() {},
        };

        server
          .connect(t)
          .then(() =>
            t.handleRequest(
              fakeReq as unknown as express.Request,
              noopRes as unknown as express.Response,
              initBody,
            ),
          );
      },
    );

    // Complete the MCP handshake with notifications/initialized.
    // Re-use the same noop shape as the first stub — same @hono/node-server requirements.
    const noopRes2 = createNoopResponse();

    const initializedNotification = {
      jsonrpc: '2.0' as const,
      method: 'notifications/initialized',
    };

    const fakeNotifReq = {
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': newSessionId,
      },
      rawHeaders: [
        'content-type',
        'application/json',
        'mcp-session-id',
        newSessionId ?? '',
      ],
      socket: { encrypted: false, remoteAddress: '127.0.0.1' },
      body: initializedNotification,
      on() {
        return fakeNotifReq;
      },
      once() {
        return fakeNotifReq;
      },
      off() {
        return fakeNotifReq;
      },
      resume() {},
    };

    await transport.handleRequest(
      fakeNotifReq as unknown as express.Request,
      noopRes2 as unknown as express.Response,
      initializedNotification,
    );

    // Patch the response header so the CLI picks up the new session ID and
    // update the request header for the forwarded handleRequest call.
    res.setHeader('Mcp-Session-Id', newSessionId!);
    req.headers['mcp-session-id'] = newSessionId;

    // Forward the original tool-call body to the now-initialized transport.
    await transport.handleRequest(req, res, req.body);
  }

  // Handle POST /mcp — initialize new sessions or route to existing ones
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Route to existing session
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — allow reinitialize even with a stale session ID header so that
    // clients whose session was lost (e.g. server restart) can reconnect without
    // having to clear their own session ID first.
    if (isInitializeRequest(req.body)) {
      connectionCounter++;
      const connectionId = randomUUID();
      const connectionName = `Agent ${connectionCounter}`;
      const server = createMcpServerWithTools(
        getWindow,
        connectionId,
        connectionName,
        getOpenCodePort,
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions[id] = { transport, server, connectionId };

          // Auto-create session channel so the UI input bar appears immediately
          createSessionChannel(connectionId, connectionName);
          writeSessionFile(connectionId, port);

          getWindow()?.webContents.send('connection-opened', {
            connectionId,
            name: connectionName,
            sessionId: connectionId,
            label: connectionName,
          });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions[sid]) {
          const { connectionId: connId } = sessions[sid];
          delete sessions[sid];
          cancelActivePrompt(connId);
          deleteSessionChannel(connId);
          clearSessionFile();
          getWindow()?.webContents.send('connection-closed', {
            connectionId: connId,
          });
          getWindow()?.webContents.send('session-channel-deleted', {
            sessionId: connId,
          });
        }
        server.close().catch(() => {});
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // ─── Transparent session resurrection ───
    // Stale session ID + non-initialize body (e.g. a tool call) → silently
    // create a new session, run the MCP handshake internally, and forward the
    // original request so the CLI never sees an error.
    if (sessionId) {
      try {
        await handleTransparentReinit(req, res);
        return;
      } catch (err) {
        console.error(
          '[mcp] transparent reinit failed, falling back to 404:',
          err,
        );
      }
    }

    // Per MCP spec: 404 signals "session expired" → client MUST reinitialize
    res.status(404).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Session not found or expired. Please reinitialize.',
      },
      id: null,
    });
  });

  // Handle GET /mcp — SSE stream for server-initiated messages
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res);
    } else {
      res.status(404).json({ error: 'Session not found or expired' });
    }
  });

  // Handle DELETE /mcp — client session teardown
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (sessionId && sessions[sessionId]) {
      const { connectionId } = sessions[sessionId];
      await sessions[sessionId].transport.handleRequest(req, res);
      delete sessions[sessionId];
      cancelActivePrompt(connectionId);
      getWindow()?.webContents.send('connection-closed', { connectionId });
    } else {
      res.status(404).json({ error: 'Session not found or expired' });
    }
  });

  // ─── Session channel REST API ───
  app.use(createApiRouter({ getWindow }));

  app.get('/health', (_req, res) => {
    const activeClients = Object.keys(sessions).length;
    res.json({
      status: 'ok',
      activeClients,
      tools: [
        'register_connection',
        'request_user_input',
        'start_intensive_chat',
        'ask_intensive_chat',
        'stop_intensive_chat',
        'push_session_status',
        'send_message',
      ],
    });
  });

  httpServer = app.listen(port, () => {
    console.log(
      `MCP Streamable HTTP server listening on http://localhost:${port}/mcp`,
    );
  });
}

export function stopMcpServer(): void {
  if (httpServer) {
    httpServer.closeAllConnections();
    httpServer.close();
    httpServer = null;
  }
  _sessionCleanup = null;
}

export async function restartMcpServer(): Promise<void> {
  if (!_startParams) return;
  stopMcpServer();
  clearSessionFile();
  await startMcpServer(
    _startParams.port,
    _startParams.getWindow,
    _startParams.getSoundEnabled,
    _startParams.getPromptTimeoutMs,
    _startParams.getOpenCodePort,
  );
}

export async function closeSessionByConnectionId(
  connectionId: string,
): Promise<boolean> {
  if (!_sessionCleanup) return false;
  return _sessionCleanup(connectionId);
}
