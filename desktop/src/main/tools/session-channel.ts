import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';

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
      getWindow()?.webContents.send('session-status-update', {
        connectionId,
        status,
        type,
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
