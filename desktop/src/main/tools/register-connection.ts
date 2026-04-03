import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import { upsertRegisteredConnection, createSessionChannel } from '../database';

export function registerConnectionTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
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
- (!important!) If you are OpenCode, pass your current session ID as openCodeSessionId so the desktop app can inject context messages directly into your session using noReply:true (zero LLM cost).
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
- openCodeSessionId: OpenCode session ID (optional). Pass this if you are running inside OpenCode so the desktop app can inject context messages into your session via the OpenCode HTTP API using noReply:true, which appends context to the conversation without triggering an additional LLM call.
</parameters>

<examples>
- { "agentName": "Claude Code", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project" }
- { "agentName": "Research Agent", "projectName": "literature-review" }
- { "agentName": "OpenCode", "projectName": "my-project", "baseDirectory": "/Users/me/projects/my-project", "openCodeSessionId": "ses_abc123" }
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
            'OpenCode session ID — pass this when running inside OpenCode to enable noReply context injection',
          ),
      },
    },
    async ({
      agentName,
      projectName,
      baseDirectory,
      openCodeSessionId,
    }): Promise<CallToolResult> => {
      // Persist registration: upsert DB record + write /tmp ID file
      const idFilePath = upsertRegisteredConnection({
        connectionId,
        agentName,
        projectName,
        baseDirectory,
        openCodeSessionId,
      });

      // Update the channel label in the DB
      createSessionChannel(connectionId, agentName);

      // Tell the UI to rename this connection's channel
      getWindow()?.webContents.send('connection-registered', {
        connectionId,
        agentName,
        projectName,
        baseDirectory: baseDirectory ?? null,
        label: agentName,
        openCodeSessionId: openCodeSessionId ?? null,
      });

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
              idFilePath,
              message:
                `Connection registered successfully. Your channel "${agentName}" is now visible in the ` +
                `Interactive MCP Desktop app. Use your connectionId (${connectionId}) with other tools. ` +
                `Your connection ID is also saved to ${idFilePath} for recovery after restarts.` +
                (openCodeSessionId
                  ? ` OpenCode session ID "${openCodeSessionId}" registered — context messages from the desktop app will be injected directly into your session.`
                  : ''),
            }),
          },
        ],
      };
    },
  );
}
