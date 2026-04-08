import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import {
  upsertRegisteredConnection,
  createSessionChannel,
  isOpenCodeSessionClaimed,
} from '../database';
import { autoDetectOpenCodeSession } from '../opencode-session';
import { triggerSessionTreeUpdate } from '../session-tree-manager';
import { initDocContext } from '../doc-context-injector';
import { injectOpenCodeMessage } from '../opencode-injector';

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
  agentName: string;
  projectName: string;
  baseDirectory?: string;
}): string {
  const { agentName, projectName, baseDirectory } = params;
  const locationLine = baseDirectory
    ? `- Base directory: ${baseDirectory}`
    : '- Base directory: not provided';

  return [
    '<system-reminder>',
    'Interactive MCP Desktop session bootstrap:',
    `- Registered agent: ${agentName}`,
    `- Project: ${projectName}`,
    locationLine,
    '- Prompting policy: use interactive prompt tools for user questions.',
    '- Timeout policy: if a prompt times out or returns a timeout error (including -32001), re-prompt immediately.',
    '- Stop phrases (exact match): "Stop prompting", "End session", "Don\'t ask anymore", "Close conversation".',
    '- Parallel subagents should use unique agent names to avoid sidebar name collisions.',
    '</system-reminder>',
  ].join('\n');
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
  });
}

export function registerConnectionTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  getOpenCodePort: () => number,
  getDocIndexingEnabled: () => boolean,
  onRegistered?: (connectionId: string) => void | Promise<void>,
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
- (!important!) Use clear, human-readable agentName values so channels are easy to distinguish in the sidebar.
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
- agentName: Human-readable name for this agent shown in the channel sidebar. Prefer unique names per active agent/session (especially for spawned subagents) to avoid channel-name collisions.
- projectName: Name of the project or workspace this agent is working in.
- baseDirectory: Absolute path to the working directory / repository root (optional but recommended for file autocomplete).
- openCodeSessionId: Your own OpenCode session ID (optional). Pass this explicitly when you know it (e.g. as a subagent). Takes precedence over auto-detection. Enables the desktop app to inject context directly into your session.
</parameters>

<examples>
- { "agentName": "<Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "agentName": "Agent <Task name>", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project" }
- { "agentName": "Research <Task name> Agent", "projectName": "literature-review" }
- { "agentName": "Research <Task name> Agent A", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
- { "agentName": "Research <Task name> Agent B", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_def456" }
</examples>`,
      title: 'Register this agent as a named connection',
      inputSchema: {
        agentName: z
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
      agentName,
      projectName,
      baseDirectory,
      openCodeSessionId: explicitSessionId,
    }): Promise<CallToolResult> => {
      const startedAt = Date.now();

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

      if (!openCodeSessionId && baseDirectory) {
        const detected = await withRegisterConnectionDeadline(
          autoDetectOpenCodeSession(getOpenCodePort(), baseDirectory),
          startedAt,
        );
        if (detected) {
          // Guard: only bind to the detected session if it isn't already
          // claimed by another connection. If it IS claimed, this agent is
          // almost certainly a subagent that forgot to pass its own session ID
          // — binding it to the root's session would route its prompts to the
          // root channel.
          const alreadyClaimed = isOpenCodeSessionClaimed(
            detected.id,
            connectionId,
          );
          if (!alreadyClaimed) {
            openCodeSessionId = detected.id;
            parentSessionId = detected.parentId;
          }
        }
      } else if (openCodeSessionId) {
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
        agentName,
        projectName,
        baseDirectory,
        openCodeSessionId: openCodeSessionId ?? undefined,
        parentSessionId: parentSessionId ?? undefined,
      });

      // Update the channel label in the DB
      createSessionChannel(connectionId, agentName);

      void onRegistered?.(connectionId);

      // Immediately push a fresh session-tree snapshot so the renderer
      // reflects the new registration without waiting for the next poll tick.
      void triggerSessionTreeUpdate(getWindow, getOpenCodePort);

      // Kick off doc indexing and context injection in the background.
      // Fire-and-forget — this should not delay the registration response.
      if (baseDirectory && openCodeSessionId && getDocIndexingEnabled()) {
        void initDocContext(
          baseDirectory,
          openCodeSessionId,
          getOpenCodePort(),
          connectionId,
          getWindow,
        );
      }

      const startupContextMessage = buildStartupContextMessage({
        agentName,
        projectName,
        baseDirectory,
      });

      // Provider-aware startup injection (Phase 1):
      // - OpenCode path: inject into the provider session via noReply so it is
      //   visible in the OpenCode transcript and available in model context.
      // - Standalone path: include the same context as part of this tool result
      //   so the caller still receives deterministic startup context.
      if (openCodeSessionId) {
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
          'Startup context prepared (standalone mode)',
          'info',
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              connectionId,
              agentName,
              projectName,
              baseDirectory: baseDirectory ?? null,
              openCodeSessionId: openCodeSessionId ?? null,
              parentSessionId: parentSessionId ?? null,
              idFilePath,
              message:
                `Connection registered successfully. Your channel "${agentName}" is now visible in the ` +
                `Interactive MCP Desktop app. Use your connectionId (${connectionId}) with other tools. ` +
                `Your connection ID is also saved to ${idFilePath} for recovery after restarts.` +
                (openCodeSessionId
                  ? ` OpenCode session "${openCodeSessionId}" detected — context messages from the desktop app will be injected directly into your session.`
                  : '') +
                (parentSessionId
                  ? ` Parent session: "${parentSessionId}".`
                  : ''),
            }),
          },
          {
            type: 'text' as const,
            text: startupContextMessage,
          },
        ],
      };
    },
  );
}
