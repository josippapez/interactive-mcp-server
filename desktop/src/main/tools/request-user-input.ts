import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import type { PromptData } from '../ipc-prompt';
import { getPromptTimeoutSeconds } from '../ipc-prompt';

type PromptUserFn = (
  win: BrowserWindow | null,
  data: PromptData,
) => Promise<string>;

export function registerRequestUserInput(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  promptFn: PromptUserFn,
  connectionId: string,
  connectionName: string,
): void {
  server.tool(
    'request_user_input',
    'Send a question to the user via the Interactive MCP Desktop app. Returns the user response.',
    {
      projectName: z
        .string()
        .describe('Project name shown in the prompt header'),
      message: z.string().describe('The question to ask the user'),
      predefinedOptions: z
        .array(z.string())
        .optional()
        .describe('Optional predefined options for quick selection'),
      baseDirectory: z
        .string()
        .describe('Repository root for file autocomplete scope'),
    },
    async ({ projectName, message, predefinedOptions, baseDirectory }) => {
      const promptId = randomUUID();
      const answer = await promptFn(getWindow(), {
        id: promptId,
        message,
        projectName,
        predefinedOptions,
        baseDirectory,
        connectionId,
        connectionName,
        timeoutSeconds: getPromptTimeoutSeconds(),
      });

      if (!answer) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'User did not reply: Timeout occurred.',
            },
          ],
        };
      }
      if (answer === '') {
        return {
          content: [
            { type: 'text' as const, text: 'User replied with empty input.' },
          ],
        };
      }
      return {
        content: [{ type: 'text' as const, text: `User replied: ${answer}` }],
      };
    },
  );
}
