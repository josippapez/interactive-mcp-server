import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import {
  upsertRegisteredConnection,
  createSessionChannel,
  isOpenCodeSessionClaimed,
  getConnectionClaimingSession,
  clearConnectionOpenCodeSession,
  listSkillsAndInstructions,
  getRegisteredConnection,
} from '../database';
import { autoDetectOpenCodeSession } from '../opencode-session';
import {
  triggerSessionTreeUpdate,
  recordPendingConnection,
} from '../session-tree-manager';
import { initDocContext } from '../doc-context-injector';
import { injectOpenCodeMessage } from '../opencode-injector';
import { getBackendAdapter } from '../backend-adapter';
import type { AgentBackend } from '../settings';

const REGISTER_CONNECTION_TIMEOUT_MS = 15_000;
const REGISTER_CONNECTION_TIMEOUT_MESSAGE =
  'register_connection timed out after 15s';

function ensureRegisterConnectionTimeRemaining(startedAt: number): number {
  const elapsed = Date.now() - startedAt;
  const remaining = REGISTER_CONNECTION_TIMEOUT_MS - elapsed;
  if (remaining <= 0) {
    throw new Error(REGISTER_CONNECTION_TIMEOUT_MESSAGE);
  }
  return remaining;
}

async function withRegisterConnectionDeadline<T>(
  promise: Promise<T>,
  startedAt: number,
): Promise<T> {
  const remaining = ensureRegisterConnectionTimeRemaining(startedAt);

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(REGISTER_CONNECTION_TIMEOUT_MESSAGE));
    }, remaining);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRegisterConnectionTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === REGISTER_CONNECTION_TIMEOUT_MESSAGE
  );
}

function buildStartupContextMessage(params: {
  channelName: string;
  projectName: string;
  baseDirectory?: string;
}): string {
  const { channelName, projectName, baseDirectory } = params;
  const locationLine = baseDirectory
    ? `- Base directory: ${baseDirectory}`
    : '- Base directory: not provided';

  const lines = [
    '<system-reminder>',
    'Interactive MCP Desktop session bootstrap:',
    `- Registered agent: ${channelName}`,
    `- Project: ${projectName}`,
    locationLine,
    '- Prompting policy: use interactive prompt tools for user questions.',
    '- Timeout policy: if a prompt times out or returns a timeout error (including -32001), re-prompt immediately.',
    '- Stop phrases (exact match): "Stop prompting", "End session", "Don\'t ask anymore", "Close conversation".',
    '- Parallel subagents should use unique agent names to avoid sidebar name collisions.',
  ];

  // Inject all registered skills and instructions
  const entries = listSkillsAndInstructions();
  if (entries.length > 0) {
    const skills = entries.filter((e) => e.type === 'skill');
    const instructions = entries.filter((e) => e.type === 'instruction');

    if (skills.length > 0) {
      lines.push('');
      lines.push('Available Skills:');
      for (const skill of skills) {
        lines.push(`- ${skill.name}: ${skill.description}`);
      }
    }

    if (instructions.length > 0) {
      lines.push('');
      lines.push('Active Instructions:');
      for (const instruction of instructions) {
        lines.push(`- ${instruction.name}: ${instruction.description}`);
      }
    }

    lines.push('');
    lines.push(
      'Use the manage_skills_and_instructions tool with action "get" to retrieve the full content of any skill or instruction by name.',
    );
  }

  lines.push('</system-reminder>');
  return lines.join('\n');
}

function pushSessionStatus(
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  status: string,
  type: 'info' | 'working' | 'success' | 'error',
): void {
  getWindow()?.webContents.send('session-status-update', {
    connectionId,
    status,
    type,
    openCodeSessionId:
      getRegisteredConnection(connectionId)?.openCodeSessionId ?? null,
  });
}

export function registerConnectionTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  getOpenCodePort: () => number,
  getDocIndexingEnabled: () => boolean,
  getAgentBackend: () => AgentBackend,
  onRegistered?: (connectionId: string) => void | Promise<void>,
  isConnectionLive?: (connectionId: string) => boolean,
): void {
  server.registerTool(
    'register_connection',
    {
      description: `<description>
Register this agent as a named connection in the Interactive MCP Desktop app.
Call this tool once at the start of every session to establish a persistent, human-readable channel.
After registration, your channel will appear in the app's sidebar with the given name.
</description>

<importantNotes>
- (!important!) Call this tool at the start of each session before using other tools.
- (!important!) If a user deletes your session from the app, call this tool again to re-establish the connection.
- (!important!) Other tools will return an error with instructions to call register_connection if your session has been removed.
- (!important!) The connectionId returned by this tool is automatically used by all other tools.
- (!important!) Use clear, human-readable channelName values so channels are easy to distinguish in the sidebar.
- (!important!) For spawned/parallel subagents, use a unique task label (for example "Research Agent A", "Research Agent B") to avoid duplicate names.
- (!important!) If you pass baseDirectory and omit openCodeSessionId, the desktop app will auto-detect your active session for context injection — this is the correct path for the main agent.
- (!important!) If you are a subagent spawned via the Task tool, you MUST pass your own OpenCode session ID via the openCodeSessionId parameter. Without it your channel will have no injection target and messages typed in your channel will not reach you.
- (!important!) This tool has a hard 15-second deadline; if registration does not complete in time, it fails so callers can retry cleanly.
</importantNotes>

<whenToUseThisTool>
- At the very start of each agent session (first tool call)
- After receiving an error message instructing you to re-register
- When resuming work after a long pause and you're unsure if the session is still active
</whenToUseThisTool>

<parameters>
- channelName: Human-readable name for this agent shown in the channel sidebar. Prefer unique names per active agent/session (especially for spawned subagents) to avoid channel-name collisions.
- projectName: Name of the project or workspace this agent is working in.
- baseDirectory: Absolute path to the working directory / repository root (optional but recommended for file autocomplete).
- openCodeSessionId: Your own OpenCode session ID (optional). Pass this explicitly when you know it (e.g. as a subagent). Takes precedence over auto-detection. Enables the desktop app to inject context directly into your session.
</parameters>

<examples>
- { "channelName": "<Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "channelName": "Agent <Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project" }
- { "channelName": "Research <Task name> Agent", "projectName": "literature-review" }
- { "channelName": "Research <Task name> Agent A", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "channelName": "Research <Task name> Agent B", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_def456" }
</examples>`,
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

      // Use explicitly provided session ID if given.
      // Only auto-detect when baseDirectory is also provided — that is the
      // reliable signal that this is the main agent calling from a real project
      // context. Subagents that omit openCodeSessionId (e.g. they forgot to
      // pass it) must NOT fall through to auto-detection, as that would point
      // their channel at whatever the most-recently-created session happens to
      // be, causing messages intended for that subagent to land in the wrong
      // agent's context.
      let openCodeSessionId: string | null = explicitSessionId ?? null;
      let parentSessionId: string | null = null;

      if (!backend.supportsProviderInjection) {
        openCodeSessionId = null;
      }

      if (backend.backend === 'claude_sdk' && backend.runtime?.available) {
        pushSessionStatus(
          getWindow,
          connectionId,
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
          // Guard: only bind to the detected session if it isn't already
          // claimed by a LIVE connection. If the claiming connection's
          // transport is dead (stale DB record from a previous run), clear
          // the claim and take over — this is the normal reconnect path.
          const claimingId = getConnectionClaimingSession(
            detected.id,
            connectionId,
          );
          const claimedByLive =
            claimingId != null &&
            (isConnectionLive == null || isConnectionLive(claimingId));

          if (!claimedByLive) {
            if (claimingId != null) {
              // Stale claim — release it so the new connection can bind.
              clearConnectionOpenCodeSession(claimingId);
              console.log(
                `[register-connection] released stale claim on session ${detected.id} from dead connection ${claimingId}`,
              );
            }
            openCodeSessionId = detected.id;
            parentSessionId = detected.parentId;
          }
        }
      } else if (backend.supportsProviderInjection && openCodeSessionId) {
        // When session ID is explicit, try to fetch its parentID from the API.
        try {
          const port = getOpenCodePort();
          const res = await withRegisterConnectionDeadline(
            fetch(`http://localhost:${port}/session`, {
              signal: AbortSignal.timeout(2000),
            }),
            startedAt,
          );
          if (res.ok) {
            const sessions = (await withRegisterConnectionDeadline(
              res.json() as Promise<unknown>,
              startedAt,
            )) as Array<{
              id: string;
              parentID?: string | null;
            }>;
            const match = sessions.find((s) => s.id === openCodeSessionId);
            parentSessionId = match?.parentID ?? null;
          }
        } catch (error) {
          if (isRegisterConnectionTimeoutError(error)) {
            throw error;
          }
          // non-critical — parentSessionId stays null
        }
      }

      ensureRegisterConnectionTimeRemaining(startedAt);

      // Persist registration: upsert DB record + write /tmp ID file
      const idFilePath = upsertRegisteredConnection({
        connectionId,
        channelName,
        projectName,
        baseDirectory,
        openCodeSessionId: openCodeSessionId ?? undefined,
        parentSessionId: parentSessionId ?? undefined,
      });

      // If no openCodeSessionId was resolved yet, register this connection as
      // "pending" so the SSE auto-bind logic can attach it when the matching
      // child session arrives via session.created.1.
      if (!openCodeSessionId && backend.supportsProviderInjection) {
        recordPendingConnection(connectionId);
      }

      // Update the channel label in the DB
      createSessionChannel(connectionId, channelName);

      void onRegistered?.(connectionId);

      // Immediately push a fresh session-tree snapshot so the renderer
      // reflects the new registration without waiting for the next poll tick.
      if (backend.supportsSessionHierarchy) {
        void triggerSessionTreeUpdate(getWindow, getOpenCodePort);
      }

      // Kick off doc indexing and context injection in the background.
      // Fire-and-forget — this should not delay the registration response.
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

      const startupContextMessage = buildStartupContextMessage({
        channelName,
        projectName,
        baseDirectory,
      });

      // Provider-aware startup injection (Phase 1):
      // - OpenCode path: inject into the provider session via noReply so it is
      //   visible in the OpenCode transcript and available in model context.
      // - Standalone path: include the same context as part of this tool result
      //   so the caller still receives deterministic startup context.
      if (backend.supportsProviderInjection && openCodeSessionId) {
        pushSessionStatus(
          getWindow,
          connectionId,
          'Injecting startup context into OpenCode session…',
          'working',
        );

        void (async () => {
          const injectionResult = await injectOpenCodeMessage(
            openCodeSessionId,
            startupContextMessage,
            undefined,
            getOpenCodePort(),
          );

          if (injectionResult.ok) {
            pushSessionStatus(
              getWindow,
              connectionId,
              'Startup context injected into OpenCode session',
              'success',
            );
            return;
          }

          pushSessionStatus(
            getWindow,
            connectionId,
            `Startup context injection failed: ${injectionResult.error ?? 'unknown error'}`,
            'error',
          );
        })();
      } else {
        pushSessionStatus(
          getWindow,
          connectionId,
          `Startup context prepared (${backend.backend} mode)`,
          'info',
        );

        if (backend.runtime && !backend.runtime.available) {
          pushSessionStatus(
            getWindow,
            connectionId,
            backend.runtime.message,
            'error',
          );
        }
      }

      // When a provider session is active, the startupContextMessage is
      // injected via noReply (fire-and-forget above). Including it *also* in
      // the tool-result content would cause it to appear in every parent
      // session that aggregates subagent tool results — exactly the
      // "system-reminder injected into all agents" problem.
      //
      // Rule: include startupContextMessage in tool-result content ONLY when
      // there is no openCodeSessionId (standalone mode / no noReply path).
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
        // No noReply injection path — include context in tool result so the
        // agent still receives it (standalone / Claude SDK modes).
        toolResultContent.push({
          type: 'text' as const,
          text: startupContextMessage,
        });
      }

      return { content: toolResultContent };
    },
  );
}
