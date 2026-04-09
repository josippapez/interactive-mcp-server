import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * In-memory set of connection IDs that were explicitly removed by the user
 * from the Interactive MCP Desktop app.
 *
 * When the user deletes a session, the IPC handler calls
 * `markConnectionDeleted(connectionId)` so that subsequent tool calls on
 * that connectionId can return an actionable error instead of silently failing.
 *
 * This set is process-scoped — it resets if the app restarts (acceptable
 * because after a restart agents will reinitialize their MCP sessions anyway).
 */
const _deletedConnections = new Set<string>();

/** Mark a connectionId as explicitly deleted by the user. */
export function markConnectionDeleted(connectionId: string): void {
  _deletedConnections.add(connectionId);
}

/**
 * If `connectionId` was explicitly deleted by the user, returns a structured,
 * actionable `CallToolResult` error instructing the agent to call
 * `register_connection`.  Returns `null` if the connection is still active.
 */
export function staleConnectionError(
  connectionId: string,
): CallToolResult | null {
  if (!_deletedConnections.has(connectionId)) return null;

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'SESSION_REMOVED',
          message:
            'Your session was removed from the Interactive MCP Desktop app by the user. ' +
            'You must re-register before using any other tools.',
          action:
            'Call the register_connection tool with your channelName, projectName, and baseDirectory to re-establish your channel.',
          example: {
            tool: 'register_connection',
            arguments: {
              channelName: '<your channel name>',
              projectName: '<your project name>',
              baseDirectory: '<absolute path to your working directory>',
            },
          },
        }),
      },
    ],
  };
}
