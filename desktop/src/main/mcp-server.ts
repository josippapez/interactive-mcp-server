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
import { basename } from 'path';
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
import { registerFindRepoDocsTool } from './tools/find-repo-docs';
import { registerManageSkillsAndInstructionsTool } from './tools/manage-skills-and-instructions';
import {
  createSessionChannel,
  deleteSessionChannel,
  getAllRegisteredConnections,
  upsertRegisteredConnection,
  getConnectionClaimingSession,
  clearConnectionOpenCodeSession,
} from './database';
import {
  writeSessionFile,
  clearSessionFile,
  writeMcpConfigHint,
  MCP_CONFIG_FILE,
} from './session-file';
import { createApiRouter } from './api-routes';
import { cleanupOldAttachments } from './attachment-store';
import { pickUnregisteredConnectionsForCleanup } from './session-registration-cleanup';
import { autoDetectOpenCodeSession } from './opencode-session';
import { triggerSessionTreeUpdate } from './session-tree-manager';
import type { AgentBackend } from './settings';

const DEFAULT_MAIN_CHANNEL_NAME = 'OpenCode - Main Channel';

let httpServer: Server | null = null;
let _sessionCleanup: ((connectionId: string) => Promise<boolean>) | null = null;
let _clearAllSessions: (() => Promise<number>) | null = null;
let _activeSessionCountGetter: (() => number) | null = null;

let _attachmentCleanupInterval: ReturnType<typeof setInterval> | null = null;

// Stored params for restart support
let _startParams: {
  port: number;
  getWindow: () => BrowserWindow | null;
  getSoundEnabled: () => boolean;
  getPromptTimeoutMs: () => number;
  getOpenCodePort: () => number;
  getDocIndexingEnabled: () => boolean;
  getAgentBackend: () => AgentBackend;
} | null = null;

/** Create a fresh McpServer with all tools registered (one per connection). */
function createMcpServerWithTools(
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  connectionName: string,
  getOpenCodePort: () => number,
  getDocIndexingEnabled: () => boolean,
  getAgentBackend: () => AgentBackend,
  getSessionEntries: () => Array<{
    connectionId: string;
    connectionName: string;
    isRegistered: boolean;
  }>,
  cleanupConnection: (connectionId: string) => Promise<boolean>,
  isConnectionLive: (id: string) => boolean,
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
  registerConnectionTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend,
    async (registeredConnectionId) => {
      const channelName =
        getSessionEntries().find(
          (entry) => entry.connectionId === registeredConnectionId,
        )?.connectionName ?? '';
      const toCleanup = pickUnregisteredConnectionsForCleanup(
        getSessionEntries(),
        { connectionId: registeredConnectionId, channelName },
      );
      for (const staleConnectionId of toCleanup) {
        await cleanupConnection(staleConnectionId);
      }
    },
    isConnectionLive,
  );
  registerFindRepoDocsTool(server, connectionId);
  registerManageSkillsAndInstructionsTool(server, getWindow, connectionId);
  return server;
}

export async function startMcpServer(
  port: number,
  getWindow: () => BrowserWindow | null,
  getSoundEnabled: () => boolean = () => true,
  getPromptTimeoutMs: () => number = () => 200_000,
  getOpenCodePort: () => number = () => 4096,
  getDocIndexingEnabled: () => boolean = () => true,
  getAgentBackend: () => AgentBackend = () => 'standalone',
): Promise<void> {
  _startParams = {
    port,
    getWindow,
    getSoundEnabled,
    getPromptTimeoutMs,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend,
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
      connectionName: string;
    }
  > = {};
  const findSessionByConnectionId = (connectionId: string): string | null => {
    for (const [sid, entry] of Object.entries(sessions)) {
      if (entry.connectionId === connectionId) return sid;
    }
    return null;
  };

  const getSessionEntries = () => {
    const registeredConnections = getAllRegisteredConnections();
    const registeredById = new Map(
      registeredConnections.map((rc) => [rc.connectionId, rc]),
    );

    return Object.values(sessions).map((entry) => ({
      connectionId: entry.connectionId,
      connectionName:
        registeredById.get(entry.connectionId)?.channelName ??
        entry.connectionName,
      isRegistered: registeredById.has(entry.connectionId),
    }));
  };

  const autoRegisterDefaultConnection = async (
    connectionId: string,
    channelName: string,
  ): Promise<void> => {
    // process.cwd() is '/' when the app is launched from the macOS Dock or at
    // login item, which would cause the doc indexer to traverse the entire
    // filesystem. Fall back to the user's home directory in that case.
    const rawCwd = process.cwd();
    const baseDirectory =
      rawCwd === '/' || rawCwd === ''
        ? (process.env.HOME ?? process.env.USERPROFILE ?? rawCwd)
        : rawCwd;
    const projectName = basename(baseDirectory) || 'project';
    const backend = getAgentBackend();
    const openCodeEnabled = backend === 'opencode';

    // Only auto-detect the OpenCode session for the main channel. Subagent
    // connections (channelName !== DEFAULT_MAIN_CHANNEL_NAME, i.e. "Agent N")
    // ALWAYS call register_connection explicitly with their own openCodeSessionId.
    // Auto-detecting here for subagents would incorrectly assign the root/parent
    // session ID to their connectionId (because autoDetectOpenCodeSession prefers
    // root sessions), causing their prompts to appear in the parent's channel.
    const isMainChannel = channelName === DEFAULT_MAIN_CHANNEL_NAME;
    let detected: Awaited<ReturnType<typeof autoDetectOpenCodeSession>> = null;
    if (openCodeEnabled && isMainChannel) {
      try {
        detected = await autoDetectOpenCodeSession(
          getOpenCodePort(),
          baseDirectory,
        );
      } catch {
        // non-critical: still register defaults without a session binding
      }
    }

    // Guard: if the detected session is already claimed by another connection
    // (e.g. a previous main-channel binding that survived a soft restart),
    // do NOT re-bind this new connection to the same session. Two connections
    // sharing the same openCodeSessionId causes their prompts and channels to
    // collide in the renderer's session tree.
    //
    // If the claiming connection is no longer live (stale DB record), clear it
    // and allow this new connection to take over.
    if (detected) {
      const claimingId = getConnectionClaimingSession(
        detected.id,
        connectionId,
      );
      if (claimingId != null) {
        if (findSessionByConnectionId(claimingId) != null) {
          // Still live — do not steal the session
          detected = null;
        } else {
          // Stale claim — release it so this connection can bind
          clearConnectionOpenCodeSession(claimingId);
        }
      }
    }

    upsertRegisteredConnection({
      connectionId,
      channelName,
      projectName,
      baseDirectory,
      openCodeSessionId: detected?.id ?? undefined,
      parentSessionId: detected?.parentId ?? undefined,
    });

    createSessionChannel(connectionId, channelName);

    const toCleanup = pickUnregisteredConnectionsForCleanup(
      getSessionEntries(),
      {
        connectionId,
        channelName,
      },
    );
    for (const staleConnectionId of toCleanup) {
      await _sessionCleanup?.(staleConnectionId);
    }

    if (openCodeEnabled && detected) {
      // An OpenCode session is bound — the session-tree-updated snapshot will
      // create the renderer node via mergeSessionTreeSnapshot. Emitting
      // connection-opened here would create a redundant direct-connection node
      // that the snapshot cannot yet absorb (race). Skip it; the snapshot is
      // sufficient.
      void triggerSessionTreeUpdate(getWindow, getOpenCodePort);
    } else {
      // No OpenCode session detected — emit connection-opened so the renderer
      // shows a direct-connection node immediately (classic non-OC path).
      getWindow()?.webContents.send('connection-opened', {
        connectionId,
        name: channelName,
        sessionId: connectionId,
        label: channelName,
      });
      if (openCodeEnabled) {
        void triggerSessionTreeUpdate(getWindow, getOpenCodePort);
      }
    }
  };

  _sessionCleanup = async (connectionId: string): Promise<boolean> => {
    const sid = findSessionByConnectionId(connectionId);
    if (!sid) return false;
    const session = sessions[sid];
    delete sessions[sid];
    // Close the MCP server first so the SDK aborts in-flight tool handler
    // AbortControllers (via Protocol._onclose), then close the transport.
    try {
      await session.server.close();
    } catch {
      // best effort close
    }
    try {
      await session.transport.close();
    } catch {
      // best effort close
    }
    return true;
  };

  /**
   * Clear all in-memory MCP sessions without stopping the HTTP listener.
   * Each session's transport and server are closed, active prompts are cancelled,
   * and the renderer is notified. The HTTP server stays up so the next client
   * request triggers a fresh initialize handshake (or transparent reinit)
   * instead of getting ECONNREFUSED.
   */
  _clearAllSessions = async (): Promise<number> => {
    const entries = Object.entries(sessions);
    let cleared = 0;
    for (const [sid, entry] of entries) {
      delete sessions[sid];
      cancelActivePrompt(entry.connectionId);
      deleteSessionChannel(entry.connectionId);
      // Close the MCP server first so the SDK aborts in-flight tool handler
      // AbortControllers (via Protocol._onclose), then close the transport.
      // This ensures tool handlers see the abort signal before the HTTP
      // streams are torn down, preventing the "no connection established"
      // error that causes tool-call results to be silently dropped.
      try {
        await entry.server.close();
      } catch {
        // best effort
      }
      try {
        await entry.transport.close();
      } catch {
        // best effort
      }
      getWindow()?.webContents.send('connection-closed', {
        connectionId: entry.connectionId,
      });
      getWindow()?.webContents.send('session-channel-deleted', {
        sessionId: entry.connectionId,
      });
      cleared++;
    }
    clearSessionFile();
    return cleared;
  };

  let connectionCounter = 0;
  let mainChannelAssignedInRuntime = false;

  const resolveConnectionName = (): string => {
    if (!mainChannelAssignedInRuntime) {
      mainChannelAssignedInRuntime = true;
      return DEFAULT_MAIN_CHANNEL_NAME;
    }
    return `Agent ${connectionCounter}`;
  };

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
    const connectionName = resolveConnectionName();
    const server = createMcpServerWithTools(
      getWindow,
      connectionId,
      connectionName,
      getOpenCodePort,
      getDocIndexingEnabled,
      getAgentBackend,
      getSessionEntries,
      async (connId: string) => _sessionCleanup?.(connId) ?? false,
      (id: string) =>
        Object.values(sessions).some((s) => s.connectionId === id),
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
            sessions[id] = {
              transport: t,
              server,
              connectionId,
              connectionName,
            };

            void autoRegisterDefaultConnection(connectionId, connectionName);
            writeSessionFile(connectionId, port, getPromptTimeoutMs());

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
      const connectionName = resolveConnectionName();
      const server = createMcpServerWithTools(
        getWindow,
        connectionId,
        connectionName,
        getOpenCodePort,
        getDocIndexingEnabled,
        getAgentBackend,
        getSessionEntries,
        async (connId: string) => _sessionCleanup?.(connId) ?? false,
        (id: string) =>
          Object.values(sessions).some((s) => s.connectionId === id),
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions[id] = {
            transport,
            server,
            connectionId,
            connectionName,
          };

          // Auto-register a stable named channel so reconnects do not stay as
          // generic "Agent N" channels.
          // connection-opened is emitted inside autoRegisterDefaultConnection
          // only when no OpenCode session is detected, to avoid a race where
          // both a direct-connection node and a session-tree snapshot node are
          // created simultaneously (dual-entry bug).
          void autoRegisterDefaultConnection(connectionId, connectionName);
          writeSessionFile(connectionId, port, getPromptTimeoutMs());
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
    if (!sessionId || !sessions[sessionId]) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const { connectionId } = sessions[sessionId];

    // Let the transport set up the SSE stream first.
    await sessions[sessionId].transport.handleRequest(req, res);

    // ── Part 1: SSE keepalive heartbeat ─────────────────────────────────────
    // Write a keepalive SSE comment every 15 s so the OS never considers the
    // TCP connection idle and kills it while a prompt is pending.
    const keepaliveInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepaliveInterval);
        return;
      }
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepaliveInterval);
      }
    }, 15_000);

    // ── Part 2: Dead-stream detection ────────────────────────────────────────
    // When the SSE client socket closes (OS killed connection, app backgrounded,
    // etc.) without a clean DELETE /mcp, abort any active prompt for this
    // connection so the waiting tool call can resolve and the POST stream can
    // drain, which in turn lets transport.onclose fire for full cleanup.
    const onSocketGone = (): void => {
      clearInterval(keepaliveInterval);
      cancelActivePrompt(connectionId);
    };

    res.socket?.once('close', onSocketGone);
    res.socket?.once('error', onSocketGone);

    // Stop the keepalive and detach socket listeners when the response ends
    // cleanly (e.g. transport.onclose already called res.end()).
    res.once('close', () => {
      clearInterval(keepaliveInterval);
      res.socket?.removeListener('close', onSocketGone);
      res.socket?.removeListener('error', onSocketGone);
    });
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
  app.use(
    createApiRouter({
      getWindow,
      clearAllSessions: _clearAllSessions,
      getOpenCodePort,
    }),
  );

  app.get('/health', (_req, res) => {
    const activeClients = Object.keys(sessions).length;
    res.json({
      status: 'ok',
      activeClients,
      mcpConfigFile: MCP_CONFIG_FILE,
      tools: [
        'register_connection',
        'request_user_input',
        'start_intensive_chat',
        'ask_intensive_chat',
        'stop_intensive_chat',
        'push_session_status',
        'send_message',
        'find_repo_docs',
        'manage_skills_and_instructions',
      ],
    });
  });

  httpServer = app.listen(port, () => {
    console.log(
      `MCP Streamable HTTP server listening on http://localhost:${port}/mcp`,
    );
    // Write the session file immediately so clients can discover the port
    // before any agent connects. The sessionId is 'server' as a placeholder.
    writeSessionFile('server', port, getPromptTimeoutMs());
    // Write a ready-to-use MCP config snippet for OpenCode
    writeMcpConfigHint(port);
  });

  // Keep HTTP connections alive long enough to outlast even the longest
  // possible prompt timeout. Without this, the OS or a local proxy can kill
  // an idle TCP socket mid-tool-call, producing a -32000 "Connection closed"
  // error on the agent side even though the user may have answered.
  //
  // We use a fixed 2-hour ceiling rather than reading getPromptTimeoutMs()
  // here, because the user can change the timeout in Settings at any time and
  // the HTTP server is only created once. The prompt's own setTimeout handles
  // actual expiry — the HTTP layer should never be the limiting factor.
  // headersTimeout must be strictly greater than keepAliveTimeout (Node docs).
  const HTTP_KEEPALIVE_MS = 2 * 60 * 60 * 1000; // 2 hours
  httpServer.keepAliveTimeout = HTTP_KEEPALIVE_MS;
  httpServer.headersTimeout = HTTP_KEEPALIVE_MS + 1_000;

  // Periodically clean up old attachment files (every 6 hours)
  cleanupOldAttachments();
  _attachmentCleanupInterval = setInterval(
    () => cleanupOldAttachments(),
    6 * 60 * 60 * 1000,
  );

  _activeSessionCountGetter = () => Object.keys(sessions).length;
}

export function stopMcpServer(): void {
  if (_attachmentCleanupInterval) {
    clearInterval(_attachmentCleanupInterval);
    _attachmentCleanupInterval = null;
  }
  if (httpServer) {
    httpServer.closeAllConnections();
    httpServer.close();
    httpServer = null;
  }
  _sessionCleanup = null;
  _clearAllSessions = null;
  _activeSessionCountGetter = null;
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
    _startParams.getDocIndexingEnabled,
    _startParams.getAgentBackend,
  );
}

/**
 * Soft-restart: clear all in-memory MCP sessions but keep the HTTP listener
 * running. Clients that send their next request will get a transparent reinit
 * (or a fresh initialize handshake) instead of ECONNREFUSED.
 *
 * Returns the number of sessions that were cleared, or 0 if the server is not
 * running.
 */
export async function softRestartMcpServer(): Promise<number> {
  if (!_clearAllSessions) return 0;
  return _clearAllSessions();
}

export async function closeSessionByConnectionId(
  connectionId: string,
): Promise<boolean> {
  if (!_sessionCleanup) return false;
  return _sessionCleanup(connectionId);
}

export function getActiveMcpSessionCount(): number {
  return _activeSessionCountGetter?.() ?? 0;
}
