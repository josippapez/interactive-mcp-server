import { useCallback } from 'react';
import type { SessionNode } from '../../types';
import { getRemoveSessionTarget } from '../remove-session-target';

interface SessionHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
}

export function useSessionHandlers({
  nodesRef,
  setNodes,
}: SessionHandlersOptions) {
  const handleDismissSession = useCallback((connectionId: string) => {
    void window.api.dismissSession?.(connectionId);
  }, []);

  const handleRemoveSession = useCallback(
    (sessionId: string): Promise<boolean> => {
      const targetSessionId = getRemoveSessionTarget(
        nodesRef.current.get(sessionId),
        sessionId,
      );
      return window.api.removeSessionChannel(targetSessionId);
    },
    [nodesRef],
  );

  const handleReplyPermission = useCallback(
    (
      sessionID: string,
      requestId: string,
      reply: 'once' | 'always' | 'reject',
    ) => {
      // Optimistically remove from state immediately so the UI clears at once
      setNodes((prev) => {
        let nodeId: string | null = null;
        for (const [id, node] of prev) {
          if (node.pendingPermissions?.some((p) => p.requestId === requestId)) {
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
      void window.api.replyPermission(sessionID, requestId, reply);
    },
    [setNodes],
  );

  return {
    handleDismissSession,
    handleRemoveSession,
    handleReplyPermission,
  };
}
