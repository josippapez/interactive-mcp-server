/**
 * Abort a running OpenCode session.
 *
 * Uses the OpenCode SDK to stop a running agent session.
 *
 * IMPORTANT: opencode's `WorkspaceRouterMiddleware` routes SDK calls to the
 * correct `Instance` based on the `directory` header (forwarded by
 * `withDirectory`/`getClient`). Without it, an abort request dispatched from
 * the desktop app's `process.cwd()` context will hit the wrong Instance and
 * silently no-op, leaving in-flight tool calls stuck with `status='running'`.
 *
 * We look up the session's registered `baseDirectory` from the local DB and
 * forward it through to `sessionAbort`, mirroring the pattern used by
 * `permission-reply.ts` and `question-list.ts`.
 */

import { getRegisteredConnectionBySessionId } from './database';
import { sessionAbort } from './session-api';
import { createLogger } from '../../utils/logger';
import { errorMessage } from '../../utils/errors';
import { getOpenCodePassword } from './opencode/password-subject';

const abortLog = createLogger('abort');

/**
 * Abort an OpenCode session by ID.
 *
 * Diagnostic preconditions logged on every call:
 *   - port (must match the running OpenCode server)
 *   - sessionId (must match an active provider session)
 *   - directory header (required by opencode WorkspaceRouterMiddleware in
 *     Mode B/C; missing → silent no-op routed to wrong Instance)
 *   - hasPassword (required in Mode C; missing → 401 from server)
 *
 * @param openCodePort - The port OpenCode server is running on
 * @param sessionId - The OpenCode session ID to abort
 * @returns true if abort succeeded, false otherwise
 */
export async function abortOpenCodeSession(
  openCodePort: number,
  sessionId: string,
): Promise<boolean> {
  const registered = await getRegisteredConnectionBySessionId(
    sessionId,
    'opencode',
  );
  const effectiveDirectory = registered?.baseDirectory ?? undefined;
  const hasPassword = getOpenCodePassword() !== null;

  // Surface preconditions explicitly. If `directory` is missing or `hasPassword`
  // is false in Mode C, the call WILL silently no-op or 401.
  if (!registered) {
    abortLog.warn(
      `no registered_connections row for session=${sessionId} — abort will be routed to opencode default Instance and may no-op`,
    );
  }
  if (!effectiveDirectory) {
    abortLog.warn(
      `session=${sessionId} has no baseDirectory in DB — abort RPC will not include opencode-directory header`,
    );
  }

  try {
    abortLog.info(
      `start session=${sessionId} port=${openCodePort} directory=${effectiveDirectory ?? '(none)'} hasPassword=${hasPassword}`,
    );
    const response = await sessionAbort(openCodePort, sessionId, {
      directory: effectiveDirectory,
      signal: AbortSignal.timeout(5000),
    });

    abortLog.info(
      `response session=${sessionId} data=${JSON.stringify(response.data)} error=${JSON.stringify(response.error)}`,
    );

    if (response.error) {
      abortLog.warn(
        `error session=${sessionId} directory=${effectiveDirectory ?? '(none)'} error=${JSON.stringify(response.error)}`,
      );
      return false;
    }

    // The SDK returns the boolean directly in response.data
    const data = response.data;
    if (typeof data === 'boolean') {
      if (!data) {
        abortLog.warn(
          `abort returned false session=${sessionId} directory=${effectiveDirectory ?? '(none)'} — opencode WorkspaceRouterMiddleware may have routed to the wrong Instance`,
        );
      }
      return data;
    }

    abortLog.warn(
      `unexpected response format session=${sessionId} data=${JSON.stringify(data)}`,
    );
    return false;
  } catch (err) {
    // Don't log AbortError (timeout) as it's expected when server is unavailable
    if ((err as { name?: string }).name !== 'AbortError') {
      abortLog.warn(
        `exception session=${sessionId} directory=${effectiveDirectory ?? '(none)'} error=${errorMessage(err)}`,
      );
    }
    return false;
  }
}
