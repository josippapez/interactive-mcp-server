import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserWindow } from 'electron';
import { promptUser } from '../ipc/prompt';
import { registerRequestUserInput } from '../tools/request-user-input';
import { registerIntensiveChatTools } from '../tools/intensive-chat';
import {
  registerSessionChannelTools,
  registerSendMessageTool,
} from '../tools/session-channel';
import {
  registerConnectionTool,
  type ProviderType,
} from '../tools/register-connection';
import { registerFindRepoDocsTool } from '../tools/find-repo-docs';
import { registerManageSkillsAndInstructionsTool } from '../tools/manage-skills-and-instructions';
import { registerPollContextInjectionsTool } from '../tools/poll-context-injections';
import { pickUnregisteredConnectionsForCleanup } from '../session/registration-cleanup';
import type { AgentBackend } from '../settings';
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
        providerSessionId: openCodeSessionId ?? null,
      });
    },
  );
  registerFindRepoDocsTool(server, connectionId, requireSessionId);
  registerManageSkillsAndInstructionsTool(
    server,
    getWindow,
    connectionId,
    getOpenCodePort,
  );
  registerPollContextInjectionsTool(server, connectionId, requireSessionId);
  applyHiddenToolListFilter(server);
  return server;
}
