import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
import { registerNotificationTool } from './tools/notification';
import { registerIntensiveChatTools } from './tools/intensive-chat';

let httpServer: Server | null = null;

/** Create a fresh McpServer with all tools registered (one per SSE connection). */
function createMcpServerWithTools(
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  connectionName: string,
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
  registerNotificationTool(server);
  registerIntensiveChatTools(
    server,
    getWindow,
    promptUser,
    connectionId,
    connectionName,
  );
  return server;
}

export async function startMcpServer(
  port: number,
  getWindow: () => BrowserWindow | null,
  getSoundEnabled: () => boolean = () => true,
  getPromptTimeoutMs: () => number = () => 800_000,
): Promise<void> {
  setSoundEnabled(getSoundEnabled);
  setPromptTimeout(getPromptTimeoutMs);
  const app = express();

  // ─── SSE Transport (one McpServer per connection) ───
  const sessions: Record<
    string,
    { transport: SSEServerTransport; server: McpServer; connectionId: string }
  > = {};
  let connectionCounter = 0;

  app.get('/sse', async (_req, res) => {
    connectionCounter++;
    const connectionId = randomUUID();
    const connectionName = `Agent ${connectionCounter}`;
    const server = createMcpServerWithTools(
      getWindow,
      connectionId,
      connectionName,
    );
    const transport = new SSEServerTransport('/messages', res);
    sessions[transport.sessionId] = { transport, server, connectionId };

    getWindow()?.webContents.send('connection-opened', {
      connectionId,
      name: connectionName,
    });

    res.on('close', () => {
      delete sessions[transport.sessionId];
      cancelActivePrompt(connectionId);
      getWindow()?.webContents.send('connection-closed', { connectionId });
      server.close().catch(() => {});
    });
    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const session = sessions[sessionId];
    if (session) {
      await session.transport.handlePostMessage(req, res);
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  app.get('/health', (_req, res) => {
    const activeClients = Object.keys(sessions).length;
    res.json({
      status: 'ok',
      activeClients,
      tools: [
        'request_user_input',
        'message_complete_notification',
        'start_intensive_chat',
        'ask_intensive_chat',
        'stop_intensive_chat',
      ],
    });
  });

  httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`MCP SSE server listening on http://0.0.0.0:${port}`);
  });
}

export function stopMcpServer(): void {
  if (httpServer) {
    httpServer.closeAllConnections();
    httpServer.close();
    httpServer = null;
  }
}
