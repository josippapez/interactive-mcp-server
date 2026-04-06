import type { SessionNode } from '../types';

export function resolveSessionActionTarget(args: {
  requestedId: string;
  connectionId?: string | null;
  sessionChannelId?: string | null;
}): string {
  return args.sessionChannelId ?? args.connectionId ?? args.requestedId;
}

export function getRemoveSessionTarget(
  node: SessionNode | null | undefined,
  requestedId: string,
): string {
  return resolveSessionActionTarget({
    requestedId,
    connectionId: node?.connectionId,
    sessionChannelId: node?.sessionChannel?.sessionId,
  });
}
