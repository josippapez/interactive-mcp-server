import { getRegisteredConnectionBySessionId } from '../database';
import {
  createOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2/client';
import { createLogger } from '../utils/logger';

export type PermissionReply = 'once' | 'always' | 'reject';

const permissionLog = createLogger('permission');

let _permissionClientFactory: (
  openCodePort: number,
  directory?: string,
) => OpencodeClient = (openCodePort: number, directory?: string) =>
  createOpencodeClient({
    baseUrl: `http://localhost:${openCodePort}`,
    directory,
  });

export function _setPermissionClientFactory(
  factory: (openCodePort: number, directory?: string) => OpencodeClient,
): void {
  _permissionClientFactory = factory;
}

export function _resetPermissionClientFactory(): void {
  _permissionClientFactory = (openCodePort: number, directory?: string) =>
    createOpencodeClient({
      baseUrl: `http://localhost:${openCodePort}`,
      directory,
    });
}

export async function replyToOpenCodePermission(
  openCodePort: number,
  sessionID: string,
  requestID: string,
  reply: PermissionReply,
  directory?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const registered = getRegisteredConnectionBySessionId(sessionID, 'opencode');
    const effectiveDirectory = directory ?? registered?.baseDirectory ?? undefined;
    const client = _permissionClientFactory(
      openCodePort,
      effectiveDirectory,
    );
    permissionLog.info(
      `reply start session=${sessionID} request=${requestID} reply=${reply} directory=${effectiveDirectory ?? '(none)'} baseDirectory=${registered?.baseDirectory ?? '(none)'}`,
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
    const message = err instanceof Error ? err.message : String(err);
    permissionLog.error(
      `reply exception session=${sessionID} request=${requestID} reply=${reply} error=${message}`,
    );
    return { ok: false, error: message };
  }
}
