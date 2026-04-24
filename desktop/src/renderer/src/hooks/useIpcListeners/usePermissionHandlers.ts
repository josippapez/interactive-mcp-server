import type { PendingPermission } from '../../types';
import type { HandlerContext } from './types';
import { findKeyByConnectionId } from './helpers';

/**
 * Registers IPC listeners for permission-related events.
 *
 * Consumes the unified `conversation-batch` stream — the legacy
 * `permission-asked` / `permission-replied` dedicated IPC channels were
 * never emitted by the main process after the C6 streaming rewrite, which
 * caused live permission prompts to silently disappear in the renderer.
 * Now permission events are mapped by `event-bridge.ts::bridgeEvent` into
 * `ConversationEvent` variants (`permission.asked` / `permission.replied`)
 * and delivered through `onConversationBatch` alongside every other
 * live-session signal.
 *
 * Returns a disposer that removes every listener registered here.
 */
export function usePermissionHandlers({
  setNodes,
  bufferPermission,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  const applyPermissionAsked = (permission: PendingPermission): void => {
    setNodes((prev) => {
      // Providers other than OpenCode don't push `permission.asked`
      // through this pipeline, so `connectionId` resolution falls
      // back to `providerSessionId` lookup only.
      const nodeId = findKeyByConnectionId(prev, null, permission.sessionID);
      if (!nodeId) {
        bufferPermission(permission);
        return prev;
      }
      const node = prev.get(nodeId)!;
      if (
        node.pendingPermissions.some(
          (p) => p.requestId === permission.requestId,
        )
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(nodeId, {
        ...node,
        pendingPermissions: [...node.pendingPermissions, permission],
      });
      return next;
    });
  };

  const applyPermissionReplied = (requestId: string): void => {
    setNodes((prev) => {
      let nodeId: string | null = null;
      for (const [id, node] of prev) {
        if (node.pendingPermissions.some((p) => p.requestId === requestId)) {
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
          (p) => p.requestId !== requestId,
        ),
      });
      return next;
    });
  };

  disposers.push(
    window.api.onPermissionAsked?.((data) => {
      applyPermissionAsked({
        requestId: data.requestId,
        sessionID: data.sessionID,
        permission: data.permission,
        patterns: data.patterns,
        always: data.always,
        tool: data.tool,
        metadata: data.metadata,
      });
    }),
  );

  disposers.push(
    window.api.onPermissionReplied?.((data) => {
      applyPermissionReplied(data.requestID);
    }),
  );

  disposers.push(
    window.api.onConversationBatch?.((batch) => {
      for (const evt of batch.events) {
        if (evt.type === 'permission.asked') {
          applyPermissionAsked({
            requestId: evt.requestId,
            sessionID: evt.sessionId,
            permission: evt.permission,
            patterns: evt.patterns,
            always: evt.always,
            tool: evt.tool,
            metadata: evt.metadata,
          });
          continue;
        }

        if (evt.type === 'permission.replied') {
          applyPermissionReplied(evt.requestId);
          continue;
        }
      }
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
