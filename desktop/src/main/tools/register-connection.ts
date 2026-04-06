import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import { upsertRegisteredConnection, createSessionChannel } from '../database';
import { autoDetectOpenCodeSession } from '../opencode-session';
import { triggerSessionTreeUpdate } from '../session-tree-manager';
import { initDocContext } from '../doc-context-injector';

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
- agentName: Human-readable name for this agent (e.g. "Claude Code - my-project"). Shown in the channel sidebar.
- projectName: Name of the project or workspace this agent is working in.
- baseDirectory: Absolute path to the working directory / repository root (optional but recommended for file autocomplete).
- openCodeSessionId: Your own OpenCode session ID (optional). Pass this explicitly when you know it (e.g. as a subagent). Takes precedence over auto-detection. Enables the desktop app to inject context directly into your session.
</parameters>

<examples>
- { "agentName": "Claude Code", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project" }
- { "agentName": "Research Agent", "projectName": "literature-review" }
- { "agentName": "Subagent - fe-specialist", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
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
          openCodeSessionId = detected.id;
          parentSessionId = detected.parentId;
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
        ],
      };
    },
  );
}
