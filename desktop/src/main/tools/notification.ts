import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Notification } from 'electron';

export function registerNotificationTool(server: McpServer): void {
  server.tool(
    'message_complete_notification',
    'Send an OS notification to the user. Use after completing a significant task.',
    {
      projectName: z
        .string()
        .describe('The project name for the notification title'),
      message: z.string().describe('The notification body text'),
    },
    ({ projectName, message }) => {
      new Notification({ title: projectName, body: message }).show();
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Notification sent. You can now wait for user input.',
          },
        ],
      };
    },
  );
}
