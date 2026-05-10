import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserWindow } from 'electron';
import type { AgentBackend } from '../../../settings-core';
import { promptUser } from '../prompt-client';
import { registerRepoDocsTools } from '../tools/find-repo-docs';
import { registerIntensiveChatTools } from '../tools/intensive-chat';
import { registerManageSkillsAndInstructionsTool } from '../tools/manage-skills-and-instructions';
import { registerPollContextInjectionsTool } from '../tools/poll-context-injections';
import { registerConnectionTool } from '../tools/register-connection';
import { registerRequestUserInput } from '../tools/request-user-input';
import {
  registerSendMessageTool,
  registerSessionChannelTools,
} from '../tools/session-channel';
import { getEffectiveProvider } from './provider-detection';
import { applyHiddenToolListFilter } from './tool-list-filter';

/** Create a fresh McpServer with all tools registered (one per connection). */
export function createMcpServerWithTools(
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  connectionName: string,
  getOpenCodePort: () => number,
  getDocIndexingEnabled: () => boolean,
  getAgentBackend: () => AgentBackend,
  getSessionEntries: () => Promise<
    Array<{
      connectionId: string;
      connectionName: string;
      isRegistered: boolean;
    }>
  >,
  cleanupConnection: (connectionId: string) => Promise<boolean>,
  requestHeaders?: Record<string, string | string[] | undefined>,
): McpServer {
  const server = new McpServer(
    { name: 'Interactive MCP Desktop', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const providerType = getEffectiveProvider(getAgentBackend(), requestHeaders);
  const requireSessionId = providerType === 'opencode';

  registerConnectionTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
    getDocIndexingEnabled,
    getAgentBackend,
    () => providerType,
  );
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
  registerRepoDocsTools(server, connectionId, requireSessionId);
  registerPollContextInjectionsTool(server, connectionId, requireSessionId);
  registerManageSkillsAndInstructionsTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
  );

  void getSessionEntries;
  void cleanupConnection;

  applyHiddenToolListFilter(server);
  return server;
}
