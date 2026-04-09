import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import { staleConnectionError } from './connection-guard';
import {
  appendSessionChannelMessage,
  getRegisteredConnection,
} from '../database';

/** Returns an actionable error if the agent hasn't called register_connection yet. */
function unregisteredConnectionError(
  connectionId: string,
): CallToolResult | null {
  if (getRegisteredConnection(connectionId) !== null) return null;
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'NOT_REGISTERED',
          message:
            'You must call register_connection before using send_message. ' +
            'Without registration there is no channel to send to and the message will be lost.',
          action:
            'Call the register_connection tool with your channelName, projectName, and baseDirectory first.',
        }),
      },
    ],
  };
}

export function registerSessionChannelTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
): void {
  // ─── Tool: push_session_status ───
  server.registerTool(
    'push_session_status',
    {
      description: `<description>
Push a non-blocking status update to the UI. Returns immediately. Use to keep the user informed about what the agent is currently doing.
</description>

<importantNotes>
- (!important!) Non-blocking — returns immediately without waiting for user input.
- (!important!) Use frequently to keep the user informed of progress on long-running tasks.
- (!important!) Do NOT use as a substitute for request_user_input when user input is needed.
- (!important!) This is a one-way status push; it does not collect a response from the user.
</importantNotes>

<whenToUseThisTool>
- When starting a long-running operation (e.g. "Running tests...", "Building project...")
- When completing a major step in a multi-step task
- When switching between different phases of work
- To show progress indicators without blocking the agent workflow
- Anytime the agent is about to do something that may take a while
</whenToUseThisTool>

<features>
- Sends a status message instantly to the UI status bar
- Supports visual type indicators: info, working, success, error
- Non-blocking: agent continues immediately after the call
- Scoped to the current connection/session
</features>

<bestPractices>
- Use "working" type while actively processing
- Use "success" type when a step completes successfully
- Use "error" type when an error occurs
- Keep status messages short and action-oriented (e.g. "Running tests...", "Fixing type errors")
- Do not use for questions — use request_user_input instead
</bestPractices>

<parameters>
- status: Status message to display (short, action-oriented text)
- type: Visual indicator type — "info" | "working" | "success" | "error" (optional, defaults to "info")
</parameters>

<examples>
- { "status": "Running tests...", "type": "working" }
- { "status": "Build succeeded", "type": "success" }
- { "status": "TypeScript error found in database.ts", "type": "error" }
- { "status": "Analyzing codebase structure", "type": "info" }
</examples>`,
      title: 'Push a status update to the session channel UI',
      inputSchema: {
        status: z.string().describe('Status message to display'),
        type: z
          .enum(['info', 'working', 'success', 'error'])
          .optional()
          .describe('Visual type for the status indicator'),
      },
    },
    async ({ status, type = 'info' }): Promise<CallToolResult> => {
      const staleErr = staleConnectionError(connectionId);
      if (staleErr) return staleErr;

      getWindow()?.webContents.send('session-status-update', {
        connectionId,
        status,
        type,
        openCodeSessionId:
          getRegisteredConnection(connectionId)?.openCodeSessionId ?? null,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true }),
          },
        ],
      };
    },
  );
}

export function registerSendMessageTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
): void {
  // ─── Tool: send_message ───
  server.registerTool(
    'send_message',
    {
      description: `<description>
Send a visible, persistent message directly into the desktop app channel history. Non-blocking — returns immediately. Use to communicate information to the user without requiring a response.
</description>

<importantNotes>
- (!important!) Non-blocking — returns immediately without waiting for user input.
- (!important!) The message is persisted in channel history and survives app restarts.
- (!important!) Use this for informational updates that the user should see but doesn't need to reply to.
- (!important!) For status badges (transient, not persisted), use push_session_status instead.
</importantNotes>

<whenToUseThisTool>
- When you want to share a result, summary, or update that the user should read but doesn't need to answer
- When completing a task and want to send a final summary message
- When you need to communicate something important mid-task without interrupting the workflow
</whenToUseThisTool>

<features>
- Persisted in channel history with a distinct teal/informational visual style
- Markdown supported
- Non-blocking: agent continues immediately after the call
- Scoped to the current connection/session
</features>

<parameters>
- message: The message text to display. Markdown is supported.
</parameters>

<examples>
- { "message": "Build completed successfully. 3 files changed." }
- { "message": "## Summary\\n- Fixed 2 bugs\\n- Updated tests" }
</examples>`,
      title: 'Send a persistent message to the channel',
      inputSchema: {
        message: z
          .string()
          .describe('The message text to display. Markdown is supported.'),
      },
    },
    async ({ message }): Promise<CallToolResult> => {
      const staleErr = staleConnectionError(connectionId);
      if (staleErr) return staleErr;

      const unregisteredErr = unregisteredConnectionError(connectionId);
      if (unregisteredErr) return unregisteredErr;

      appendSessionChannelMessage({
        sessionId: connectionId,
        messageType: 'agent_message',
        messageText: message,
      });

      getWindow()?.webContents.send('agent-message', {
        connectionId,
        message,
        openCodeSessionId:
          getRegisteredConnection(connectionId)?.openCodeSessionId ?? null,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true }),
          },
        ],
      };
    },
  );
}
