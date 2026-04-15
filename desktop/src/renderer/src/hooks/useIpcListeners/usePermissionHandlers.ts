import type { PendingPermission } from '../../types';
import type { HandlerContext } from './types';
import { findKeyByConnectionId } from './helpers';

/**
 * Registers IPC listeners for permission-related events.
 * Handles: onPermissionAsked, onPermissionReplied
 */
export function usePermissionHandlers({ setNodes }: HandlerContext): void {
  // ------------------------------------------------------------------
  // Permission events — push/remove pending permission requests
  // ------------------------------------------------------------------
  window.api.onPermissionAsked?.((data) => {
    setNodes((prev) => {
      const nodeId = findKeyByConnectionId(
        prev,
        data.connectionId,
        data.openCodeSessionId,
      );
      if (!nodeId) return prev;
      const node = prev.get(nodeId)!;
      const permission: PendingPermission = {
        requestId: data.requestId,
        sessionID: data.sessionID,
        permission: data.permission,
        patterns: data.patterns,
        always: data.always,
        tool: data.tool,
        metadata: data.metadata,
      };
      const next = new Map(prev);
      next.set(nodeId, {
        ...node,
        pendingPermissions: [...node.pendingPermissions, permission],
      });
      return next;
    });
  });

  window.api.onPermissionReplied?.((data) => {
    setNodes((prev) => {
      // Find the node that owns the session
      let nodeId: string | null = null;
      for (const [id, node] of prev) {
        if (
          node.pendingPermissions.some((p) => p.requestId === data.requestID)
        ) {
          nodeId = id;
          break;
        }
      }
      if (!nodeId) return prev;
      const node = prev.get(nodeId)!;
      const next = new Map(prev);
      next.set(nodeId, {
        ...node,
        pendingPermissions: node.pendingPermissions.filter(
          (p) => p.requestId !== data.requestID,
        ),
      });
      return next;
    });
  });
}
