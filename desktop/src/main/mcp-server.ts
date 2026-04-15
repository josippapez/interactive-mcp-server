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
} from './ipc/prompt';
import { registerRequestUserInput } from './tools/request-user-input';
import { registerIntensiveChatTools } from './tools/intensive-chat';
import {
  registerSessionChannelTools,
  registerSendMessageTool,
} from './tools/session-channel';
import {
  registerConnectionTool,
  type ProviderType,
} from './tools/register-connection';
import { registerFindRepoDocsTool } from './tools/find-repo-docs';
import { registerManageSkillsAndInstructionsTool } from './tools/manage-skills-and-instructions';
import { registerPollContextInjectionsTool } from './tools/poll-context-injections';
import {
  createSessionChannel,
  deleteSessionChannel,
  getAllRegisteredConnections,
  upsertRegisteredConnection,
  getRegisteredConnectionBySessionId,
  updateConnectionId,
  deleteContextInjectionsForConnection,
} from './database';
import {
  writeSessionFile,
  clearSessionFile,
  writeMcpConfigHint,
  MCP_CONFIG_FILE,
} from './session/file';
import { createApiRouter } from './api-routes';
import { cleanupOldAttachments } from './attachment-store';
import { pickUnregisteredConnectionsForCleanup } from './session/registration-cleanup';
import { autoDetectOpenCodeSession } from './opencode/session';
import { triggerSessionTreeUpdate } from './session/tree-manager';
import type { AgentBackend } from './settings';
import { createLogger } from './utils/logger';

const mcpLog = createLogger('mcp');

const DEFAULT_MAIN_CHANNEL_NAME = 'OpenCode - Main Channel';

/**
 * Parse a provider string into a ProviderType.
 * Handles various aliases and normalizes to canonical values.
 */
function parseProviderString(value: string | undefined): ProviderType | null {
  const normalized = value?.toLowerCase()?.trim();
  switch (normalized) {
    case 'opencode':
      return 'opencode';
    case 'copilot-cli':
    case 'copilot':
      return 'copilot-cli';
    case 'claude-sdk':
    case 'claude':
      return 'claude-sdk';
    case 'standalone':
      return 'standalone';
    default:
      return null;
  }
}

/**
 * Detect provider type from HTTP request headers.
 * This allows different AI providers to be identified automatically
 * without manual switching in the desktop app settings.
 *
 * OpenCode MCP config example:
 * ```json
 * {
 *   "mcp": {
 *     "interactive-desktop": {
 *       "type": "remote",
 *       "url": "http://localhost:3100/mcp",
 *       "headers": { "X-IMCP-Provider": "opencode" }
 *     }
 *   }
 * }
 * ```
 *
 * Copilot CLI MCP config example:
 * ```json
 * {
 *   "mcpServers": {
 *     "interactive-desktop": {
 *       "url": "http://localhost:3100/mcp",
 *       "headers": { "X-IMCP-Provider": "copilot-cli" }
 *     }
 *   }
 * }
 * ```
 */
function detectProviderFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): ProviderType | null {
  // Check for X-IMCP-Provider header (case-insensitive header name)
  const headerValue =
    headers['x-imcp-provider'] ??
    headers['X-IMCP-Provider'] ??
    headers['X-Imcp-Provider'];
  if (typeof headerValue === 'string') {
    return parseProviderString(headerValue);
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return parseProviderString(headerValue[0]);
  }
  return null;
}

/**
 * Determine the effective provider type for a connection.
 * Priority order:
 * 1. X-IMCP-Provider HTTP header (per-connection identification)
 * 2. Global agentBackend setting (fallback for backwards compatibility)
 */
function getEffectiveProvider(
  globalBackend: AgentBackend,
  requestHeaders?: Record<string, string | string[] | undefined>,
): ProviderType {
  // 1. Try HTTP header first (per-connection provider identification)
  if (requestHeaders) {
    const headerProvider = detectProviderFromHeaders(requestHeaders);
    if (headerProvider) {
      return headerProvider;
    }
  }

  // 2. Fall back to global setting mapping
  switch (globalBackend) {
    case 'opencode':
      return 'opencode';
    case 'claude_sdk':
      return 'claude-sdk';
    default:
      return 'standalone';
  }
}

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
  requestHeaders?: Record<string, string | string[] | undefined>,
): McpServer {
  const server = new McpServer(
    { name: 'Interactive MCP Desktop', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  const requireSessionId = getAgentBackend() === 'opencode';

  // Detect provider type once per connection at tool registration time.
  // This captures the X-IMCP-Provider header value at connection creation.
  const detectedProvider = getEffectiveProvider(
    getAgentBackend(),
    requestHeaders,
  );
  const getDetectedProvider = (): ProviderType => detectedProvider;

  registerRequestUserInput(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
    requireSessionId,
  );
  registerIntensiveChatTools(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
    requireSessionId,
  );
  registerSessionChannelTools(
    server,
    getWindow,
    connectionId,
    requireSessionId,
  );
  registerSendMessageTool(server, getWindow, connectionId, requireSessionId);
  registerConnectionTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend,
    getDetectedProvider,
    async ({
      connectionId: registeredConnectionId,
      channelName,
      openCodeSessionId,
    }) => {
      const toCleanup = pickUnregisteredConnectionsForCleanup(
        getSessionEntries(),
        { connectionId: registeredConnectionId, channelName },
      );
      for (const staleConnectionId of toCleanup) {
        await cleanupConnection(staleConnectionId);
      }
      // Sync the sidebar label: the auto-registered name ('OpenCode - Main
      // Channel' or 'Agent N') may differ from the name the agent provided.
      getWindow()?.webContents.send('channel-label-updated', {
        connectionId: registeredConnectionId,
        name: channelName,
        openCodeSessionId,
      });
    },
  );
  registerFindRepoDocsTool(server, connectionId, requireSessionId);
  registerManageSkillsAndInstructionsTool(server, getWindow, connectionId);
  registerPollContextInjectionsTool(server, connectionId, requireSessionId);
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
      providerType: ProviderType;
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

  const autoRegisterDefaultConnection = async (
    connectionId: string,
    channelName: string,
    providerType: ProviderType,
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
    // connections ALWAYS call register_connection explicitly with their own
    // openCodeSessionId so we do not auto-detect for them here.
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

    if (detected) {
      // Phase 2: providerSessionId with composite PK. The SSE handler may have
      // already written the row (via autoRegisterSession). If so, just bind
      // this MCP transport's connectionId to the existing row.
      const existing = getRegisteredConnectionBySessionId(
        detected.id,
        'opencode',
      );
      if (existing) {
        updateConnectionId(detected.id, connectionId, 'opencode');
        createSessionChannel(connectionId, channelName);
        void triggerSessionTreeUpdate(getWindow);
        return;
      }
      // Fallback: SSE row not yet written (race or first connect).
      upsertRegisteredConnection({
        providerSessionId: detected.id,
        providerType: 'opencode',
        connectionId,
        channelName,
        projectName,
        baseDirectory,
        parentSessionId: detected.parentId ?? undefined,
      });
    } else {
      // No OpenCode session detected — use connectionId as a synthetic session
      // ID so non-OpenCode clients continue to work.
      // Use the detected provider type for isolation.
      upsertRegisteredConnection({
        providerSessionId: connectionId,
        providerType,
        connectionId,
        channelName,
        projectName,
        baseDirectory,
      });
    }

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
      void triggerSessionTreeUpdate(getWindow);
    } else {
      // No OpenCode session detected — emit connection-opened so the renderer
      // shows a direct-connection node immediately (classic non-OC path).
      getWindow()?.webContents.send('connection-opened', {
        connectionId,
        name: channelName,
        sessionId: connectionId,
        label: channelName,
        providerType,
      });
      if (openCodeEnabled) {
        void triggerSessionTreeUpdate(getWindow);
      }
    }
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
      deleteSessionChannel(entry.connectionId);
      deleteContextInjectionsForConnection(entry.connectionId);
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
    const server = createMcpServerWithTools(
      getWindow,
      connectionId,
      connectionName,
      getOpenCodePort,
      getDocIndexingEnabled,
      getAgentBackend,
      getSessionEntries,
      async (connId: string) => _sessionCleanup?.(connId) ?? false,
      req.headers,
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
              connectionId,
              connectionName,
              providerType,
            );
            writeSessionFile(connectionId, port, getPromptTimeoutMs());

            resolve(t);
          },
        });

        t.onclose = () => {
          const sid = t.sessionId;
          if (sid && sessions[sid]) {
            const { connectionId: connId } = sessions[sid];
            delete sessions[sid];
            // NOTE: We intentionally do NOT cancel active prompts here.
            // See the comment in the POST /mcp handler's transport.onclose.
            deleteSessionChannel(connId);
            deleteContextInjectionsForConnection(connId);
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
      // Detect provider type from request headers at connection creation time.
      const providerType = getEffectiveProvider(getAgentBackend(), req.headers);
      mcpLog.info(
        `New session: connectionId=${connectionId} name="${connectionName}" provider=${providerType}`,
      );
      const server = createMcpServerWithTools(
        getWindow,
        connectionId,
        connectionName,
        getOpenCodePort,
        getDocIndexingEnabled,
        getAgentBackend,
        getSessionEntries,
        async (connId: string) => _sessionCleanup?.(connId) ?? false,
        req.headers,
      );

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
            connectionId,
            connectionName,
            providerType,
          );
          writeSessionFile(connectionId, port, getPromptTimeoutMs());
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions[sid]) {
          const { connectionId: connId } = sessions[sid];
          delete sessions[sid];
          // NOTE: We intentionally do NOT cancel active prompts here.
          // transport.onclose fires when the HTTP/SSE connection drops, but
          // the prompt should survive transport reconnections (durable prompt
          // pattern). Prompts are only cancelled by explicit user/agent
          // actions: DELETE /mcp, force-terminate, or _clearAllSessions.
          deleteSessionChannel(connId);
          deleteContextInjectionsForConnection(connId);
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
      mcpLog.info(`Transparent reinit for stale sessionId=${sessionId}`);
      try {
        await handleTransparentReinit(req, res);
        return;
      } catch (err) {
        mcpLog.error(
          `Transparent reinit failed for sessionId=${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
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
  // Node.js docs recommend headersTimeout > keepAliveTimeout, but when both
  // are at MAX_INT32, adding even 1ms would overflow to a negative value and
  // trigger a TimeoutOverflowWarning. At 24.8 days, the practical difference
  // is negligible — both effectively mean "no timeout".
  const MAX_SAFE_TIMEOUT_MS = 2_147_483_647; // 2^31 - 1 ms ≈ 24.8 days
  httpServer.keepAliveTimeout = MAX_SAFE_TIMEOUT_MS;
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
