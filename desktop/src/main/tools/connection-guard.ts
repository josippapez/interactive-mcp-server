import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * In-memory set of providerSessionIds that were explicitly removed by the user
 * from the Interactive MCP Desktop app.
 *
 * When the user deletes a session, the IPC handler calls
 * `markSessionDeleted(providerSessionId)` so that subsequent tool calls on
 * that session can return an actionable error instead of silently failing.
 *
 * This set is process-scoped — it resets if the app restarts (acceptable
 * because after a restart agents will reinitialize their MCP sessions anyway).
 */
const _deletedSessions = new Set<string>();

/** Mark a providerSessionId as explicitly deleted by the user. */
export function markSessionDeleted(providerSessionId: string): void {
  _deletedSessions.add(providerSessionId);
}

/**
 * If `providerSessionId` was explicitly deleted by the user, returns a
 * structured, actionable `CallToolResult` error instructing the agent to call
 * `register_connection`. Returns `null` if the session is still active.
 */
export function staleSessionError(
  providerSessionId: string,
): CallToolResult | null {
  if (!_deletedSessions.has(providerSessionId)) return null;

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
 * Unified guard that validates the agent supplied a provider session ID on the
 * tool call. Consolidates the former `missingSessionIdError` and
 * `missingSessionIdParamError` into a single entry point.
 *
 * When `requireSessionId` is true (OpenCode backend with provider injection
 * enabled), returns a structured `MISSING_SESSION_ID` error if `providerSessionId`
 * is missing or empty. Returns `null` when the check passes or is not applicable.
 *
 * NOTE: the variable is named `providerSessionId` to match the new internal
 * identity terminology, but the MCP wire parameter that carries it remains
 * `openCodeSessionId` (public API, agent back-compat). Error message wording
 * therefore still uses `openCodeSessionId`.
 *
 * @param providerSessionId The session ID passed by the agent in the tool call
 *                          (arrives on the wire as `openCodeSessionId`).
 * @param requireSessionId  Pass `true` only when the backend supports provider
 *                          injection (i.e. `AgentBackend === 'opencode'`).
 *                          Pass `false` for standalone/non-OpenCode clients.
 */
export function requireProviderSessionId(
  providerSessionId: string | undefined | null,
  requireSessionId: boolean,
): CallToolResult | null {
  if (!requireSessionId) return null;

  if (
    typeof providerSessionId === 'string' &&
    providerSessionId.trim().length > 0
  ) {
    return null;
  }

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'MISSING_SESSION_ID',
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
