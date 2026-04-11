import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getRegisteredConnection } from '../database';

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

/**
 * When `requireSessionId` is true (OpenCode backend with provider injection
 * enabled), checks that the registered connection has an `openCodeSessionId`
 * set. Returns a structured `MISSING_SESSION_ID` error if it is absent,
 * instructing the agent to call `register_connection` again with their session
 * ID. Returns `null` if the check passes or is not applicable.
 *
 * @param connectionId     The MCP connection to inspect.
 * @param requireSessionId Pass `true` only when the backend supports provider
 *                         injection (i.e. `AgentBackend === 'opencode'`).
 *                         Pass `false` for standalone/non-OpenCode clients —
 *                         they have no session ID and that is expected.
 */
export function missingSessionIdError(
  connectionId: string,
  requireSessionId: boolean,
): CallToolResult | null {
  if (!requireSessionId) return null;

  const connection = getRegisteredConnection(connectionId);
  const sessionId = connection?.openCodeSessionId;

  if (sessionId) return null;

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'MISSING_SESSION_ID',
          message:
            'This tool requires your OpenCode session ID to route correctly. ' +
            'Your session ID was not found for this connection.',
          action:
            'Call register_connection again and include openCodeSessionId set to your OpenCode session ID ' +
            '(format: ses_<alphanumeric>). It was injected into your context at session start via a system-reminder message.',
          connectionId,
        }),
      },
    ],
  };
}

/**
 * Validates that the agent passed `openCodeSessionId` in the tool call parameters.
 * This is required for OpenCode provider connections to ensure correct message routing.
 *
 * Returns a structured `MISSING_SESSION_ID_PARAM` error if the parameter is missing
 * or empty. Returns `null` if the check passes or is not applicable.
 *
 * @param openCodeSessionId The session ID passed by the agent in the tool call.
 * @param requireSessionId  Pass `true` only when the backend supports provider
 *                          injection (i.e. `AgentBackend === 'opencode'`).
 */
export function missingSessionIdParamError(
  openCodeSessionId: string | undefined | null,
  requireSessionId: boolean,
): CallToolResult | null {
  if (!requireSessionId) return null;

  if (openCodeSessionId && openCodeSessionId.trim().length > 0) return null;

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'MISSING_SESSION_ID_PARAM',
          message:
            'You MUST pass your openCodeSessionId parameter on every tool call. ' +
            'This is required for correct message routing in multi-agent scenarios.',
          action:
            'Include the openCodeSessionId parameter (format: ses_<alphanumeric>) in your tool call. ' +
            'Your session ID was injected into your context at session start via a <system-reminder> message.',
          hint: 'Look for "<system-reminder>" in your context containing your openCodeSessionId.',
        }),
      },
    ],
  };
}
