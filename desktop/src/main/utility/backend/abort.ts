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

const abortLog = createLogger('abort');

/**
 * Abort an OpenCode session by ID.
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

  try {
    abortLog.info(
      `start session=${sessionId} directory=${effectiveDirectory ?? '(none)'} baseDirectory=${registered?.baseDirectory ?? '(none)'}`,
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
