/**
 * permission-reply.ts — reply to an OpenCode permission request via the
 * HTTP SDK.
 *
 * Runs inside the utility process. When the caller doesn't supply a
 * `directory`, we resolve the registered connection's `baseDirectory`
 * directly from the utility-local DB.
 *
 * Goes through the shared `getClient()` cache (`shared/opencode-sdk-cache.ts`)
 * so Mode C's `Authorization: Basic` interceptor is automatically applied.
 */

import { getClient } from './sdk-client';
import { createLogger } from '../../utils/logger';
import { errorMessage } from '../../utils/errors';
import { getRegisteredConnectionBySessionId } from './database';

export type PermissionReply = 'once' | 'always' | 'reject';

const permissionLog = createLogger('permission');

export async function replyToOpenCodePermission(
  openCodePort: number,
  sessionID: string,
  requestID: string,
  reply: PermissionReply,
  directory?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Fetch the registered connection from the local DB when caller didn't
    // supply a directory. Falls back to undefined (global config) if no
    // registered connection exists for the session.
    let effectiveDirectory = directory;
    let registeredBaseDirectory: string | null = null;
    if (effectiveDirectory === undefined) {
      try {
        const rc = getRegisteredConnectionBySessionId(sessionID, 'opencode');
        registeredBaseDirectory = rc?.baseDirectory ?? null;
        effectiveDirectory = registeredBaseDirectory ?? undefined;
      } catch (err) {
        permissionLog.warn(
          `baseDirectory lookup failed session=${sessionID}: ${errorMessage(err)}`,
        );
      }
    }

    const client = getClient(openCodePort, effectiveDirectory);
    permissionLog.info(
      `reply start session=${sessionID} request=${requestID} reply=${reply} directory=${effectiveDirectory ?? '(none)'} baseDirectory=${registeredBaseDirectory ?? '(none)'}`,
    );
    const result = await client.permission.reply({
      requestID,
      reply,
      directory: effectiveDirectory,
    });

    if (result.error) {
      permissionLog.error(
        `reply error session=${sessionID} request=${requestID} reply=${reply} error=${String(result.error)}`,
      );
      return { ok: false, error: String(result.error) };
    }

    permissionLog.info(
      `reply success session=${sessionID} request=${requestID} reply=${reply}`,
    );

    return { ok: true };
  } catch (err: unknown) {
    const message = errorMessage(err);
    permissionLog.error(
      `reply exception session=${sessionID} request=${requestID} reply=${reply} error=${message}`,
    );
    return { ok: false, error: message };
  }
}
