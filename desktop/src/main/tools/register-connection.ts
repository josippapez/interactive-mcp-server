import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import { getBackendAdapter } from '../backend-adapter';
import {
  createSessionChannel,
  listSkillsAndInstructions,
  upsertRegisteredConnection,
  type RegisteredConnection,
} from '../database';
import { initDocContext } from '../docs/context-injector';
import { sendSessionStatus } from '../ipc/channel';
import {
  autoDetectOpenCodeSession,
  fetchOpenCodeSession,
} from '../opencode/session';
import type { AgentBackend } from '../settings';
import {
  startStartupContextInjection,
  updateSessionTreeAfterRegistration,
} from './register-connection-background';
import {
  ensureRegisterConnectionTimeRemaining,
  isRegisterConnectionTimeoutError,
  withRegisterConnectionDeadline,
} from './register-connection-deadline';
import { REGISTER_CONNECTION_TOOL_DESCRIPTION } from './register-connection-description';
import { buildStartupContextMessage } from './startup-context';

/** Provider types supported by the multi-provider architecture. */
export type ProviderType = RegisteredConnection['providerType'];

export function registerConnectionTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  getOpenCodePort: () => number,
  getDocIndexingEnabled: () => boolean,
  getAgentBackend: () => AgentBackend,
  getDetectedProvider: () => ProviderType,
  onRegistered?: (registration: {
    connectionId: string;
    channelName: string;
    openCodeSessionId: string | null;
  }) => void | Promise<void>,
): void {
  server.registerTool(
    'register_connection',
    {
      description: REGISTER_CONNECTION_TOOL_DESCRIPTION,
      title: 'Register this agent as a named connection',
      inputSchema: {
        channelName: z
          .string()
          .describe(
            'Human-readable name for this agent shown in the channel sidebar',
          ),
        projectName: z
          .string()
          .describe(
            'Name of the project or workspace this agent is working in',
          ),
        baseDirectory: z
          .string()
          .optional()
          .describe(
            'Absolute path to the working directory / repository root (optional)',
          ),
        openCodeSessionId: z
          .string()
          .optional()
          .describe(
            'Your own OpenCode session ID (optional). Pass explicitly as a subagent to ensure correct session targeting.',
          ),
      },
    },
    async ({
      channelName,
      projectName,
      baseDirectory,
      openCodeSessionId: explicitSessionId,
    }): Promise<CallToolResult> => {
      const startedAt = Date.now();
      const backend = await getBackendAdapter(getAgentBackend());

      const detectedProvider = getDetectedProvider();

      let openCodeSessionId: string | null = explicitSessionId ?? null;
      let parentSessionId: string | null = null;

      if (!backend.supportsProviderInjection) {
        openCodeSessionId = null;
      }

      if (backend.backend === 'claude_sdk' && backend.runtime?.available) {
        sendSessionStatus(
          getWindow(),
          openCodeSessionId,
          'Claude SDK backend active (session injection adapter scaffolded)',
          'info',
        );
      }

      if (
        backend.supportsProviderInjection &&
        !openCodeSessionId &&
        baseDirectory
      ) {
        const detected = await withRegisterConnectionDeadline(
          autoDetectOpenCodeSession(getOpenCodePort(), baseDirectory),
          startedAt,
        );
        if (detected) {
          openCodeSessionId = detected.id;
          parentSessionId = detected.parentId;
        }
      } else if (backend.supportsProviderInjection && openCodeSessionId) {
        // When session ID is explicit, fetch that session directly instead of
        // listing all sessions and scanning client-side.
        try {
          const session = await withRegisterConnectionDeadline(
            fetchOpenCodeSession(
              getOpenCodePort(),
              openCodeSessionId,
              baseDirectory,
            ),
            startedAt,
          );
          if (session) {
            parentSessionId = session.parentID ?? null;
          }
        } catch (error) {
          if (isRegisterConnectionTimeoutError(error)) {
            throw error;
          }
          // non-critical — parentSessionId stays null
        }
      }

      ensureRegisterConnectionTimeRemaining(startedAt);

      const effectiveSessionId = openCodeSessionId ?? connectionId;
      const effectiveProviderType = openCodeSessionId
        ? 'opencode'
        : detectedProvider;
      const idFilePath = upsertRegisteredConnection({
        providerSessionId: effectiveSessionId,
        providerType: effectiveProviderType,
        connectionId,
        channelName,
        projectName,
        baseDirectory,
        parentSessionId: parentSessionId ?? undefined,
      });

      // Phase 6 follow-up: the legacy `recordPendingConnection` /
      // `tryAutoBindSession` heuristic was removed. Agents must pass
      // `openCodeSessionId` explicitly per the post-Phase-6 contract, so
      // there is no longer any timestamp-based binding fallback here.

      createSessionChannel(connectionId, channelName);

      void onRegistered?.({
        connectionId,
        channelName,
        openCodeSessionId,
      });

      void updateSessionTreeAfterRegistration({
        getWindow,
        connectionId,
        channelName,
        openCodeSessionId,
        parentSessionId,
        baseDirectory,
        supportsProviderInjection: backend.supportsProviderInjection,
        supportsSessionHierarchy: backend.supportsSessionHierarchy,
      });

      if (
        backend.supportsProviderInjection &&
        baseDirectory &&
        openCodeSessionId &&
        getDocIndexingEnabled()
      ) {
        void initDocContext(
          baseDirectory,
          openCodeSessionId,
          getOpenCodePort(),
          connectionId,
          getWindow,
        );
      }

      if (backend.supportsProviderInjection && baseDirectory) {
        sendSessionStatus(
          getWindow(),
          openCodeSessionId,
          'Using OpenCode workspace MCP config for this session',
          'info',
        );
      }

      const startupContextMessage = buildStartupContextMessage({
        channelName,
        projectName,
        baseDirectory,
        openCodeSessionId: openCodeSessionId ?? undefined,
        entries: listSkillsAndInstructions(),
      });

      startStartupContextInjection({
        getWindow,
        connectionId,
        openCodeSessionId,
        startupContextMessage,
        getOpenCodePort,
        backendName: backend.backend,
        runtime: backend.runtime,
        supportsProviderInjection: backend.supportsProviderInjection,
      });

      const toolResultContent: Array<{ type: 'text'; text: string }> = [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            connectionId,
            channelName,
            projectName,
            baseDirectory: baseDirectory ?? null,
            openCodeSessionId: openCodeSessionId ?? null,
            parentSessionId: parentSessionId ?? null,
            idFilePath,
            message:
              `Connection registered successfully. Your channel "${channelName}" is now visible in the ` +
              `Interactive MCP Desktop app. Use your connectionId (${connectionId}) with other tools. ` +
              `Your connection ID is also saved to ${idFilePath} for recovery after restarts.` +
              (openCodeSessionId
                ? ` OpenCode session "${openCodeSessionId}" detected — context messages from the desktop app will be injected directly into your session.`
                : '') +
              (parentSessionId ? ` Parent session: "${parentSessionId}".` : ''),
          }),
        },
      ];

      if (!openCodeSessionId) {
        toolResultContent.push({
          type: 'text' as const,
          text: startupContextMessage,
        });
      }

      return { content: toolResultContent };
    },
  );
}
