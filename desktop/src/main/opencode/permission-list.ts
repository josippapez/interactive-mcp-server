import { getClient } from './sdk-client';

export type PendingPermissionRecord = {
  requestId: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  always?: string[];
  tool?: { messageID: string; callID: string };
  metadata?: Record<string, unknown>;
};

export async function fetchPendingPermissions(
  openCodePort: number,
): Promise<PendingPermissionRecord[]> {
  try {
    const client = getClient(openCodePort);
    const result = await client.permission.list();
    const permissions = result.data ?? [];

    return permissions
      .filter((item) => item?.id && item?.sessionID && item?.permission)
      .map((item) => ({
        requestId: item.id,
        sessionID: item.sessionID,
        permission: item.permission,
        patterns: item.patterns,
        always: item.always,
        tool: item.tool,
        metadata:
          item.metadata && typeof item.metadata === 'object'
            ? (item.metadata as Record<string, unknown>)
            : undefined,
      }));
  } catch {
    return [];
  }
}
