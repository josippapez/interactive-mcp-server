import type { HandlerContext, SessionStatusType } from './types';
import { findKeyByConnectionId } from './helpers';

/**
 * Registers IPC listeners for status and agent message events.
 * Handles: onSessionStatusUpdate, onOpenCodeSessionStatus, onAgentMessage
 *
 * Returns a disposer that removes every listener registered here.
 */
export function useStatusHandlers({
  setNodes,
  appendMessage,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  // ------------------------------------------------------------------
  // Status updates and agent messages — keyed by connectionId
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onSessionStatusUpdate?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          sessionStatuses: [
            ...node.sessionStatuses,
            {
              status: data.status,
              type: data.type as SessionStatusType,
              timestamp: new Date(),
            },
          ],
        });
        return next;
      });
    }),
  );

  // ------------------------------------------------------------------
  // SSE session status — clear 'working' statuses when session goes idle
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onOpenCodeSessionStatus?.((data) => {
      // When a session becomes idle, clear any 'working' statuses from sessionStatuses
      // This prevents stale "working" indicators when subagents finish
      if (data.status === 'idle') {
        setNodes((prev) => {
          // Find node by providerSessionId (the sessionID from SSE is the providerSessionId)
          const nodeId = data.sessionID;
          if (!prev.has(nodeId)) return prev;

          const node = prev.get(nodeId)!;
          // Filter out 'working' statuses
          const filteredStatuses = node.sessionStatuses.filter(
            (s) => s.type !== 'working',
          );
          // Only update if something was actually removed
          if (filteredStatuses.length === node.sessionStatuses.length) {
            return prev;
          }

          const next = new Map(prev);
          next.set(nodeId, {
            ...node,
            sessionStatuses: filteredStatuses,
          });
          return next;
        });
      }
    }),
  );

  disposers.push(
    window.api.onAgentMessage?.((data) => {
      // Use setNodes to find the map key, then use appendMessage for the actual update.
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (nodeId) {
          // Schedule the message append outside this updater.
          setTimeout(() => {
            appendMessage(nodeId, {
              kind: 'agent_message',
              text: data.message,
              timestamp: new Date(),
            });
          }, 0);
        }
        return prev;
      });
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
