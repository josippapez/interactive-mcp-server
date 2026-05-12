import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserWindow } from 'electron';
import type { AgentBackend } from '../../../settings-core';
import { registerRepoDocsTools } from '../tools/find-repo-docs';
import { registerManageSkillsAndInstructionsTool } from '../tools/manage-skills-and-instructions';
import { registerManageMemoriesTool } from '../tools/manage-memories';
import { registerManageBackgroundSubagentsTool } from '../tools/manage-background-subagents';
import { registerMessageBackgroundSubagentTool } from '../tools/message-background-subagent';
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

  registerRepoDocsTools(server, connectionId, requireSessionId);
  registerManageSkillsAndInstructionsTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
  );
  registerManageMemoriesTool(server, connectionId);
  registerManageBackgroundSubagentsTool(server, connectionId);
  registerMessageBackgroundSubagentTool(server, connectionId);

  void connectionName;
  void getDocIndexingEnabled;
  void getSessionEntries;
  void cleanupConnection;

  applyHiddenToolListFilter(server);
  return server;
}
