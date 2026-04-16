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
 * @deprecated Phase 4 will remove this alias. Use `markSessionDeleted`.
 * Back-compat shim during the connectionId → providerSessionId refactor.
 * Callers that still pass a connectionId should migrate to passing the
 * resolved providerSessionId instead.
 */
export const markConnectionDeleted = markSessionDeleted;

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
 * @deprecated Phase 4 will remove this alias. Use `staleSessionError`.
 * Back-compat shim during the connectionId → providerSessionId refactor.
 */
export const staleConnectionError = staleSessionError;

/**
 * When `requireSessionId` is true (OpenCode backend with provider injection
 * enabled), checks that a providerSessionId has been resolved (i.e. is a
 * non-empty string). Returns a structured `MISSING_SESSION_ID` error if it is
 * absent, instructing the agent to call `register_connection` again with
 * their session ID. Returns `null` if the check passes or is not applicable.
 *
 * Phase 3 will collapse this with `missingSessionIdParamError` into a single
 * `requireProviderSessionId` helper. For Phase 2 the signature has been
 * flattened: this function no longer performs a DB lookup — the caller is
 * responsible for resolving providerSessionId before calling in.
 *
 * @param providerSessionId The resolved provider-session identity, or null.
 * @param requireSessionId  Pass `true` only when the backend supports provider
 *                          injection (i.e. `AgentBackend === 'opencode'`).
 *                          Pass `false` for standalone/non-OpenCode clients —
 *                          they have no session ID and that is expected.
 */
export function missingSessionIdError(
  providerSessionId: string | null,
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
            'This tool requires your OpenCode session ID to route correctly. ' +
            'Your session ID was not found for this connection.',
          action:
            'Call register_connection again and include openCodeSessionId set to your OpenCode session ID ' +
            '(format: ses_<alphanumeric>). It was injected into your context at session start via a system-reminder message.',
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
 * NOTE: the parameter is named `providerSessionId` to match the new internal
 * identity terminology, but the MCP wire parameter that carries it remains
 * `openCodeSessionId` (public API, agent back-compat). Error message wording
 * therefore still uses `openCodeSessionId`.
 *
 * @param providerSessionId The session ID passed by the agent in the tool call
 *                          (arrives on the wire as `openCodeSessionId`).
 * @param requireSessionId  Pass `true` only when the backend supports provider
 *                          injection (i.e. `AgentBackend === 'opencode'`).
 */
export function missingSessionIdParamError(
  providerSessionId: string | undefined | null,
  requireSessionId: boolean,
): CallToolResult | null {
  if (!requireSessionId) return null;

  if (providerSessionId && providerSessionId.trim().length > 0) return null;

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
