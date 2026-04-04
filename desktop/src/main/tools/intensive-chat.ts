import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import type { PromptUserFn } from '../ipc-prompt';
import { getPromptTimeoutSeconds } from '../ipc-prompt';
import { staleConnectionError } from './connection-guard';

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
  server.registerTool(
    'start_intensive_chat',
    {
      description: `<description>
Start an intensive chat session for gathering multiple answers quickly from the user.
**Highly recommended** for scenarios requiring a sequence of related inputs or confirmations.
Very useful for gathering multiple answers from the user in a short period of time.
Especially useful for brainstorming ideas or discussing complex topics with the user.
</description>

<importantNotes>
- (!important!) Opens a persistent interaction session that stays active for multiple questions.
- (!important!) Returns a session ID that **must** be used for subsequent questions via 'ask_intensive_chat'.
- (!important!) **Must** be closed with 'stop_intensive_chat' when finished gathering all inputs.
- (!important!) After starting a session, **immediately** continue asking all necessary questions using 'ask_intensive_chat' within the **same response message**. Do not end the response until the chat is closed with 'stop_intensive_chat'. This creates a seamless conversational flow for the user.
- (!important!) Continue the prompt loop until the user explicitly says one of: "Stop prompting", "End session", or "Don't ask anymore".
- (!important!) **NEVER use plain-text replies when a prompt trigger applies — use ask_intensive_chat to continue the session.**
- (!important!) After all questions in the session are asked, close with stop_intensive_chat and then run the mandatory satisfaction check via request_user_input.
</importantNotes>

<whenToUseThisTool>
- When you need to collect a series of quick answers from the user (more than 2-3 questions)
- When setting up a project with multiple configuration options
- When guiding a user through a multi-step process requiring input at each stage
- When gathering sequential user preferences
- When you want to maintain context between multiple related questions efficiently
- When brainstorming ideas with the user interactively
</whenToUseThisTool>

<features>
- Opens a persistent interactive prompt surface for continuous interaction
- Renders markdown prompts, including code/diff snippets, for richer question context
- Preserves markdown links, including VS Code file links (for example: "vscode://file/<abs-path>:<line>:<column>") in prompt content
- Supports option mode + free-text mode while asking follow-up questions
- Configurable timeout for each question (set via -t/--timeout, defaults to 1200 seconds)
- Returns a session ID for subsequent interactions
- Keeps full chat history visible to the user
- Maintains state between questions
- Backend-agnostic contract: start/ask/stop behavior is consistent across available UI backends
- Requires baseDirectory and pins autocomplete/search scope to the repository root
</features>

<bestPractices>
- Use a descriptive session title related to the task
- Start with a clear initial question when possible
- Use markdown for longer/multiline prompts, code fences, and diff context
- Do not ask the question if you have another tool that can answer the question
  - e.g. when you searching file in the current repository, do not ask the question "Do you want to search for a file in the current repository?"
  - e.g. prefer to use other tools to find the answer (Cursor tools or other MCP Server tools)
- Always store the returned session ID for later use
- Always close the session when you're done with stop_intensive_chat
</bestPractices>

<parameters>
- sessionTitle: Title for the intensive chat session (appears at the top of the console)
- baseDirectory: Required absolute path to the current repository root (must be a git repo root)
</parameters>

<examples>
- Start session for project setup: { "sessionTitle": "Project Configuration", "baseDirectory": "/workspace/project" }
- Start session with repository root scope: { "sessionTitle": "Project Configuration", "baseDirectory": "/workspace/project" }
</examples>`,
      inputSchema: {
        sessionTitle: z
          .string()
          .describe('Title for the intensive chat session'),
        baseDirectory: z
          .string()
          .describe(
            'Required absolute path to the current repository root (must be a git repo root; default autocomplete/search scope for this session)',
          ),
      },
    },
    async ({ sessionTitle, baseDirectory }): Promise<CallToolResult> => {
      const staleErr = staleConnectionError(connectionId);
      if (staleErr) return staleErr;

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
  server.registerTool(
    'ask_intensive_chat',
    {
      description: `<description>
Ask a new question in an active intensive chat session previously started with 'start_intensive_chat'.
</description>

<importantNotes>
- (!important!) Requires a valid session ID from 'start_intensive_chat'.
- (!important!) Supports predefined options for quick selection.
- (!important!) Returns the user's answer or indicates if they didn't respond.
- (!important!) **Use this repeatedly within the same response message** after 'start_intensive_chat' until all questions are asked.
- (!important!) If response is empty or times out for required input, re-prompt and do not proceed with assumptions.
- (!important!) Keep the loop active until the user explicitly says one of: "Stop prompting", "End session", or "Don't ask anymore".
</importantNotes>

<whenToUseThisTool>
- When continuing a series of questions in an intensive chat session.
- When you need the next piece of information in a multi-step process initiated via 'start_intensive_chat'.
- When offering multiple choice options to the user within the session.
- When gathering sequential information from the user within the session.
</whenToUseThisTool>

<features>
- Adds a new question to an existing chat session
- Supports markdown-friendly prompts (including multiline text, code fences, and diff snippets)
- Preserves markdown links, including VS Code file links (for example: "vscode://file/<abs-path>:<line>:<column>") in question text
- Supports predefined options for quick selection
- Returns the user's response
- Maintains the chat history in the console
- Requires baseDirectory for each question and scopes autocomplete/search to the repository root
</features>

<bestPractices>
- Ask one clear question at a time
- Provide predefined options when applicable
- Don't ask overly complex questions
- Keep questions focused on a single piece of information
</bestPractices>

<parameters>
- sessionId: ID of the intensive chat session (from start_intensive_chat)
- question: The question text to display to the user
- predefinedOptions: Array of predefined options for the user to choose from (optional)
- baseDirectory: Required absolute path to the current repository root (must be a git repo root)
</parameters>

<examples>
- Simple question: { "sessionId": "abcd1234", "question": "What is your project named?", "baseDirectory": "/workspace/project" }
- With predefined options: { "sessionId": "abcd1234", "question": "Would you like to use TypeScript?", "predefinedOptions": ["Yes", "No"], "baseDirectory": "/workspace/project" }
- Ask another repo-scoped question: { "sessionId": "abcd1234", "question": "Pick a file", "baseDirectory": "/workspace/project" }
</examples>`,
      title: 'Ask a question in an intensive chat session',
      inputSchema: {
        sessionId: z.string().describe('ID of the intensive chat session'),
        question: z.string().describe('Question to ask the user'),
        predefinedOptions: z
          .array(z.string())
          .optional()
          .describe(
            'Predefined options for the user to choose from (optional)',
          ),
        baseDirectory: z
          .string()
          .describe(
            'Required absolute path to the current repository root (must be a git repo root; autocomplete/search scope for this question)',
          ),
      },
    },
    async ({
      sessionId,
      question,
      predefinedOptions,
      baseDirectory,
    }): Promise<CallToolResult> => {
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
      const result = await promptFn(getWindow(), {
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

      const { answer, attachments } = result;

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

      const content: CallToolResult['content'] = [
        { type: 'text' as const, text: `User replied: ${answer}` },
      ];

      if (attachments?.length) {
        for (const att of attachments) {
          if (att.mimeType.startsWith('image/')) {
            content.push({
              type: 'image' as const,
              data: att.data,
              mimeType: att.mimeType,
            });
          } else {
            content.push({
              type: 'text' as const,
              text: `--- File: ${att.name} ---\n${att.data}`,
            });
          }
        }
      }

      return { content };
    },
  );

  // ─── Tool: stop_intensive_chat ───
  server.registerTool(
    'stop_intensive_chat',
    {
      description: `<description>
  Stop and close an active intensive chat session. **Must be called** after all questions have been asked using 'ask_intensive_chat'.
</description>

<importantNotes>
- (!important!) Closes the active intensive chat session.
- (!important!) Frees up system resources.
- (!important!) **Should always be called** as the final step when finished with an intensive chat session, typically at the end of the response message where 'start_intensive_chat' was called.
- (!important!) Only stop the session when the user explicitly wants to end prompting, such as with "Stop prompting", "End session", or "Don't ask anymore".
</importantNotes>

<whenToUseThisTool>
- When you've completed gathering all needed information via 'ask_intensive_chat'.
- When the multi-step process requiring intensive chat is complete.
- When you're ready to move on to processing the collected information.
- When the user indicates they want to end the session (if applicable).
- As the final action related to the intensive chat flow within a single response message.
</whenToUseThisTool>

<features>
- Gracefully closes the active session in the current backend
- Cleans up system resources
- Marks the session as complete
</features>

<bestPractices>
- Always stop sessions when you're done to free resources
- Provide a summary of the information collected before stopping
</bestPractices>

<parameters>
- sessionId: ID of the intensive chat session to stop
</parameters>

<examples>
- { "sessionId": "abcd1234" }
</examples>`,
      inputSchema: {
        sessionId: z
          .string()
          .describe('ID of the intensive chat session to stop'),
      },
    },
    async ({ sessionId }): Promise<CallToolResult> => {
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
