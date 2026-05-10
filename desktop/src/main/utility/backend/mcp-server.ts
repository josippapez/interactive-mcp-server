import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { cancelActivePrompt } from './prompt-client';
import type { ProviderType } from './tools/register-connection';
import {
  getAllRegisteredConnections,
  deleteSessionChannel,
  getRegisteredConnection,
  deleteContextInjectionsForSession,
} from './database';
import {
  writeSessionFile,
  clearSessionFile,
  writeMcpConfigHint,
  MCP_CONFIG_FILE,
} from './session/file';
import { createApiRouter } from './api-routes';
import { cleanupOldAttachments } from '../../attachment-store';
import { getSettingsSnapshot } from './settings-mirror';
import { createLogger } from '../../utils/logger';
import { errorMessage } from '../../utils/errors';
import { emitToRenderer } from './renderer-emit';
import { getEffectiveProvider } from './mcp-server/provider-detection';
import { createMcpServerWithTools } from './mcp-server/server-factory';
import { createNoopResponse } from './mcp-server/noop-response';
import { resolveMcpPort } from './mcp-server/port-probe';
import {
  autoRegisterDefaultConnection,
  DEFAULT_MAIN_CHANNEL_NAME,
} from './mcp-server/auto-register';
import type { SessionMap, SessionSummary } from './mcp-server/session-types';

const mcpLog = createLogger('mcp');

let httpServer: Server | null = null;
let _sessionCleanup: ((connectionId: string) => Promise<boolean>) | null = null;
let _clearAllSessions: (() => Promise<number>) | null = null;
let _activeSessionCountGetter: (() => number) | null = null;
/**
 * Port the listener actually bound to. May differ from `mcpPort` in
 * settings if the requested port was in use and the resolver probed
 * upward. `null` while the server is stopped.
 */
const _resolvedMcpPort: { value: number | null } = { value: null };

let _attachmentCleanupInterval: ReturnType<typeof setInterval> | null = null;

let _started = false;

export async function startMcpServer(): Promise<void> {
  if (_started) return;
  _started = true;
  const snapshot = getSettingsSnapshot();
  const requestedPort = snapshot.mcpPort;
  // Probe upward from the configured port. Two Eden instances on the same
  // machine (dev + prod) used to fight over 3100; now the second one
  // peacefully takes 3101 and we surface the resolved port to consumers.
  const { port } = await resolveMcpPort(requestedPort, (msg) => {
    mcpLog.info(msg);
    console.log(msg);
  });
  if (port !== requestedPort) {
    mcpLog.info(
      `MCP server requested port=${requestedPort}, bound on port=${port}`,
    );
  }
  _resolvedMcpPort.value = port;
  const getSoundEnabled = () => getSettingsSnapshot().soundEnabled;
  const getPromptTimeoutMs = () =>
    getSettingsSnapshot().promptTimeoutSeconds * 1000;
  const getOpenCodePort = () => getSettingsSnapshot().openCodePort;
  const getDocIndexingEnabled = () => getSettingsSnapshot().docIndexingEnabled;
  const getAgentBackend = () => getSettingsSnapshot().agentBackend;
  // Silence unused-var lint in case settings-mirror wiring is async.
  void getSoundEnabled;
  const app = express();
  app.use(express.json());

  // ─── Streamable HTTP Transport (one McpServer per session) ───
  const sessions: SessionMap = {};
  const findSessionByConnectionId = (connectionId: string): string | null => {
    for (const [sid, entry] of Object.entries(sessions)) {
      if (entry.connectionId === connectionId) return sid;
    }
    return null;
  };

  const getSessionEntries = async (): Promise<SessionSummary[]> => {
    const registeredConnections = await getAllRegisteredConnections();
    // Build a lookup by connection_id (transport handle). Filter out nulls.
    const registeredByConnectionId = new Map(
      registeredConnections
        .filter(
          (rc): rc is typeof rc & { connectionId: string } =>
            rc.connectionId !== null,
        )
        .map((rc) => [rc.connectionId, rc]),
    );

    return Object.values(sessions).map((entry) => ({
      connectionId: entry.connectionId,
      connectionName:
        registeredByConnectionId.get(entry.connectionId)?.channelName ??
        entry.connectionName,
      isRegistered: registeredByConnectionId.has(entry.connectionId),
    }));
  };

  _sessionCleanup = async (connectionId: string): Promise<boolean> => {
    const sid = findSessionByConnectionId(connectionId);
    if (!sid) return false;
    mcpLog.info(
      `Session cleanup: connectionId=${connectionId} sessionId=${sid}`,
    );
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

  let connectionCounter = 0;
  let mainChannelAssignedInRuntime = false;

  /**
   * Clear all in-memory MCP sessions without stopping the HTTP listener.
   * Each session's transport and server are closed, active prompts are cancelled,
   * and the renderer is notified. The HTTP server stays up so the next client
   * request triggers a fresh initialize handshake (or transparent reinit)
   * instead of getting ECONNREFUSED.
   */
  _clearAllSessions = async (): Promise<number> => {
    const entries = Object.entries(sessions);
    mcpLog.info(`Clearing all sessions: count=${entries.length}`);
    let cleared = 0;
    for (const [sid, entry] of entries) {
      delete sessions[sid];
      cancelActivePrompt(entry.connectionId);
      await deleteSessionChannel(entry.connectionId);
      const entryConn = await getRegisteredConnection(entry.connectionId);
      if (entryConn?.providerSessionId) {
        await deleteContextInjectionsForSession(
          entryConn.providerSessionId,
          entry.providerType,
        );
      }
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
      emitToRenderer('connection-closed', {
        connectionId: entry.connectionId,
      });
      emitToRenderer('session-channel-deleted', {
        sessionId: entry.connectionId,
      });
      cleared++;
    }
    clearSessionFile();
    // Reset so the next connecting agent gets 'OpenCode - Main Channel'
    // instead of 'Agent N' after a soft restart.
    connectionCounter = 0;
    mainChannelAssignedInRuntime = false;
    return cleared;
  };

  const resolveConnectionName = (): string => {
    if (!mainChannelAssignedInRuntime) {
      mainChannelAssignedInRuntime = true;
      return DEFAULT_MAIN_CHANNEL_NAME;
    }
    return `Agent ${connectionCounter}`;
  };

  const buildAutoRegisterDeps = (
    connectionId: string,
    connectionName: string,
    providerType: ProviderType,
  ) => ({
    connectionId,
    channelName: connectionName,
    providerType,
    getOpenCodePort,
    getAgentBackend,
    getSessionEntries,
    cleanupConnection: async (connId: string) =>
      (await _sessionCleanup?.(connId)) ?? false,
  });

  const buildServer = (
    connectionId: string,
    connectionName: string,
    requestHeaders: Record<string, string | string[] | undefined>,
  ): McpServer =>
    createMcpServerWithTools(
      () => null,
      connectionId,
      connectionName,
      getOpenCodePort,
      getDocIndexingEnabled,
      getAgentBackend,
      getSessionEntries,
      async (connId: string) => (await _sessionCleanup?.(connId)) ?? false,
      requestHeaders,
    );

  const handleTransportClose = async (
    sessionId: string | undefined,
  ): Promise<void> => {
    if (!sessionId || !sessions[sessionId]) return;
    const { connectionId: connId, providerType: pt } = sessions[sessionId];
    delete sessions[sessionId];
    // NOTE: We intentionally do NOT cancel active prompts here.
    // transport.onclose fires when the HTTP/SSE connection drops, but
    // the prompt should survive transport reconnections (durable prompt
    // pattern). Prompts are only cancelled by explicit user/agent
    // actions: DELETE /mcp, force-terminate, or _clearAllSessions.
    await deleteSessionChannel(connId);
    const closedConn = await getRegisteredConnection(connId);
    if (closedConn?.providerSessionId) {
      await deleteContextInjectionsForSession(closedConn.providerSessionId, pt);
    }
    clearSessionFile();
    emitToRenderer('connection-closed', {
      connectionId: connId,
    });
    emitToRenderer('session-channel-deleted', {
      sessionId: connId,
    });
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
    // Detect provider type from request headers at connection creation time.
    const providerType = getEffectiveProvider(getAgentBackend(), req.headers);
    const server = buildServer(connectionId, connectionName, req.headers);

    // Create transport and wait for onsessioninitialized to fire.
    let newSessionId: string | undefined;
    const transport = await new Promise<StreamableHTTPServerTransport>(
      (resolve) => {
        const t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            newSessionId = id;
            sessions[id] = {
              transport: t,
              server,
              connectionId,
              connectionName,
              providerType,
            };

            void autoRegisterDefaultConnection(
              buildAutoRegisterDeps(connectionId, connectionName, providerType),
            );
            writeSessionFile(connectionId, port, getPromptTimeoutMs());

            resolve(t);
          },
        });

        t.onclose = () => {
          void handleTransportClose(t.sessionId);
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
      try {
        await sessions[sessionId].transport.handleRequest(req, res, req.body);
      } catch (err) {
        // Underlying socket may have been reset/destroyed mid-flight (e.g.
        // client disconnected, renderer reloaded, SSE companion stream died).
        // Log for visibility but do NOT rethrow — Express's default error
        // handler would try to send a 500 on an already-written response,
        // producing ERR_HTTP_HEADERS_SENT and making the symptom worse on
        // the caller side (undici surfaces it as `fetch failed`).
        mcpLog.error(
          `POST /mcp route-to-existing failed sessionId=${sessionId}: ${errorMessage(err)}`,
        );
        if (!res.headersSent) {
          try {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Transport handler failed' },
              id: null,
            });
          } catch {
            // Response is already unwritable — nothing we can do.
          }
        }
      }
      return;
    }

    // New session — allow reinitialize even with a stale session ID header so that
    // clients whose session was lost (e.g. server restart) can reconnect without
    // having to clear their own session ID first.
    if (isInitializeRequest(req.body)) {
      connectionCounter++;
      const connectionId = randomUUID();
      const connectionName = resolveConnectionName();
      // Detect provider type from request headers at connection creation time.
      const providerType = getEffectiveProvider(getAgentBackend(), req.headers);
      mcpLog.info(
        `New session: connectionId=${connectionId} name="${connectionName}" provider=${providerType}`,
      );
      const server = buildServer(connectionId, connectionName, req.headers);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions[id] = {
            transport,
            server,
            connectionId,
            connectionName,
            providerType,
          };

          // Auto-register a stable named channel so reconnects do not stay as
          // generic "Agent N" channels.
          // connection-opened is emitted inside autoRegisterDefaultConnection
          // only when no OpenCode session is detected, to avoid a race where
          // both a direct-connection node and a session-tree snapshot node are
          // created simultaneously (dual-entry bug).
          void autoRegisterDefaultConnection(
            buildAutoRegisterDeps(connectionId, connectionName, providerType),
          );
          writeSessionFile(connectionId, port, getPromptTimeoutMs());
        },
      });

      transport.onclose = () => {
        void handleTransportClose(transport.sessionId);
        server.close().catch(() => {});
      };

      await server.connect(transport);
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        mcpLog.error(
          `POST /mcp initialize handleRequest failed: ${errorMessage(err)}`,
        );
        if (!res.headersSent) {
          try {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Initialize handler failed' },
              id: null,
            });
          } catch {
            // Response is already unwritable.
          }
        }
      }
      return;
    }

    // ─── Transparent session resurrection ───
    // Stale session ID + non-initialize body (e.g. a tool call) → silently
    // create a new session, run the MCP handshake internally, and forward the
    // original request so the CLI never sees an error.
    if (sessionId) {
      mcpLog.info(`Transparent reinit for stale sessionId=${sessionId}`);
      try {
        await handleTransparentReinit(req, res);
        return;
      } catch (err) {
        mcpLog.error(
          `Transparent reinit failed for sessionId=${sessionId}: ${errorMessage(err)}`,
        );
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
    // etc.) we clean up the keepalive interval but intentionally do NOT cancel
    // the active prompt. The durable prompt pattern keeps the prompt alive in
    // main-process memory so it can be delivered when the agent reconnects
    // (transparent reinit). Prompts are only cancelled by explicit user/agent
    // actions: DELETE /mcp, force-terminate, or _clearAllSessions.
    const onSocketGone = (): void => {
      clearInterval(keepaliveInterval);
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
      mcpLog.info(
        `Session teardown: connectionId=${connectionId} sessionId=${sessionId}`,
      );
      await sessions[sessionId].transport.handleRequest(req, res);
      delete sessions[sessionId];
      cancelActivePrompt(connectionId);
      emitToRenderer('connection-closed', { connectionId });
    } else {
      res.status(404).json({ error: 'Session not found or expired' });
    }
  });

  // ─── Session channel REST API ───
  app.use(
    createApiRouter({
      clearAllSessions: _clearAllSessions,
      getOpenCodePort,
      closeSessionByConnectionId: async (id: string) =>
        (await _sessionCleanup?.(id)) ?? false,
    }),
  );

  app.get('/health', (_req, res) => {
    const activeClients = Object.keys(sessions).length;
    res.json({
      status: 'ok',
      activeClients,
      mcpConfigFile: MCP_CONFIG_FILE,
      tools: [],
    });
  });

  httpServer = app.listen(port, () => {
    mcpLog.info(
      `MCP Streamable HTTP server listening on http://localhost:${port}/mcp`,
    );
    console.log(
      `MCP Streamable HTTP server listening on http://localhost:${port}/mcp`,
    );
    // Write the session file immediately so clients can discover the port
    // before any agent connects. The sessionId is 'server' as a placeholder.
    writeSessionFile('server', port, getPromptTimeoutMs());
    // Write a ready-to-use MCP config snippet for OpenCode
    writeMcpConfigHint(port);
  });

  // Keep HTTP connections alive long enough to outlast any user-configured
  // prompt timeout. Without this, the OS or a local proxy can kill an idle
  // TCP socket mid-tool-call, producing a -32000 "Connection closed" error
  // on the agent side even though the user may have answered.
  //
  // The prompt timeout is a free-form number input with no upper bound — users
  // can set it to hours or more. We use the maximum safe Node.js setTimeout
  // value (2^31 - 1 ms ≈ 24.8 days) as the ceiling so the HTTP layer never
  // becomes the limiting factor regardless of what the user configures.
  // The prompt's own setTimeout in ipc-prompt.ts handles actual expiry.
  //
  // Node.js internally validates that headersTimeout > keepAliveTimeout by
  // adding 1000ms when checking. To avoid a TimeoutOverflowWarning at MAX_INT32,
  // we set keepAliveTimeout to MAX - 1000, allowing the internal +1000 check
  // to stay within 32-bit bounds. At ~24.8 days, both effectively mean "no timeout".
  const MAX_SAFE_TIMEOUT_MS = 2_147_483_647; // 2^31 - 1 ms ≈ 24.8 days
  httpServer.keepAliveTimeout = MAX_SAFE_TIMEOUT_MS - 1000;
  httpServer.headersTimeout = MAX_SAFE_TIMEOUT_MS;

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
  _resolvedMcpPort.value = null;
  _started = false;
}

/**
 * Actually-bound port of the MCP HTTP listener, or `null` when stopped.
 * May differ from `settings.mcpPort` if the probe rolled upward.
 */
export function getResolvedMcpPort(): number | null {
  return _resolvedMcpPort.value;
}

export async function restartMcpServer(): Promise<void> {
  if (!_started) return;
  stopMcpServer();
  clearSessionFile();
  await startMcpServer();
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
