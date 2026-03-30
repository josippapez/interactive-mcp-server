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

interface IntensiveChatSession {
  title: string;
  baseDirectory?: string;
}

const activeChatSessions = new Map<string, IntensiveChatSession>();

export function registerIntensiveChatTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  promptFn: PromptUserFn,
  connectionId: string,
  connectionName: string,
): void {
  // ─── Tool: start_intensive_chat ───
  server.tool(
    'start_intensive_chat',
    'Start a persistent interactive chat session for gathering multiple answers quickly. Returns a session ID.',
    {
      sessionTitle: z.string().describe('Title for the intensive chat session'),
      baseDirectory: z
        .string()
        .describe('Repository root for file autocomplete scope'),
    },
    async ({ sessionTitle, baseDirectory }) => {
      const sessionId = randomUUID();
      activeChatSessions.set(sessionId, { title: sessionTitle, baseDirectory });
      getWindow()?.webContents.send('intensive-chat-start', {
        sessionId,
        title: sessionTitle,
        connectionId,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Intensive chat session started successfully. Session ID: ${sessionId}`,
          },
        ],
      };
    },
  );

  // ─── Tool: ask_intensive_chat ───
  server.tool(
    'ask_intensive_chat',
    'Ask a question in an active intensive chat session. Requires a valid session ID.',
    {
      sessionId: z
        .string()
        .describe('The session ID from start_intensive_chat'),
      question: z.string().describe('The question to ask the user'),
      predefinedOptions: z
        .array(z.string())
        .optional()
        .describe('Optional predefined options for quick selection'),
      baseDirectory: z
        .string()
        .describe('Repository root for file autocomplete scope'),
    },
    async ({ sessionId, question, predefinedOptions, baseDirectory }) => {
      const session = activeChatSessions.get(sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Invalid or expired session ID.',
            },
          ],
        };
      }

      const promptId = randomUUID();
      const answer = await promptFn(getWindow(), {
        id: promptId,
        message: question,
        projectName: session.title,
        predefinedOptions,
        baseDirectory: baseDirectory || session.baseDirectory,
        sessionId,
        connectionId,
        connectionName,
        timeoutSeconds: getPromptTimeoutSeconds(),
      });

      if (!answer) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'User did not reply to question in intensive chat: Timeout occurred.',
            },
          ],
        };
      }
      if (answer === '') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'User replied with empty input in intensive chat.',
            },
          ],
        };
      }
      return {
        content: [{ type: 'text' as const, text: `User replied: ${answer}` }],
      };
    },
  );

  // ─── Tool: stop_intensive_chat ───
  server.tool(
    'stop_intensive_chat',
    'Stop and close an active intensive chat session.',
    {
      sessionId: z.string().describe('The session ID to stop'),
    },
    async ({ sessionId }) => {
      const session = activeChatSessions.get(sessionId);
      if (!session) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Invalid or expired session ID.',
            },
          ],
        };
      }

      activeChatSessions.delete(sessionId);
      getWindow()?.webContents.send('intensive-chat-stop', {
        sessionId,
        connectionId,
      });

      return {
        content: [
          { type: 'text' as const, text: 'Session stopped successfully.' },
        ],
      };
    },
  );
}
