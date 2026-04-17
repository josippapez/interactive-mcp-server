import { useCallback, useEffect, useMemo } from 'react';
import { resolveSessionActionTarget } from '../../hooks/remove-session-target';
import type { SessionNode } from '../../types';

type Args = {
  connections: Map<string, SessionNode>;
  activeConnectionId: string | null;
  connectionId: string | null;
  sessionChannelId: string | null;
  pendingSessionSelect: string | null;
  onSelectConnection: (connectionId: string | null) => void;
  setPendingSessionSelect: (value: string | null) => void;
};

export function usePromptNavigationState({
  connections,
  activeConnectionId,
  connectionId,
  sessionChannelId,
  pendingSessionSelect,
  onSelectConnection,
  setPendingSessionSelect,
}: Args) {
  const activeNode = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;

  const parentInfo = useMemo(() => {
    if (!activeNode?.openCodeParentId) {
      return null;
    }

    for (const [nodeId, node] of connections) {
      if (node.providerSessionId === activeNode.openCodeParentId) {
        return { id: nodeId, title: node.title };
      }
    }

    return null;
  }, [activeNode?.openCodeParentId, connections]);

  const sessionActionTarget = useMemo(
    () =>
      activeConnectionId
        ? resolveSessionActionTarget({
            requestedId: activeConnectionId,
            connectionId,
            sessionChannelId,
          })
        : null,
    [activeConnectionId, connectionId, sessionChannelId],
  );

  useEffect(() => {
    if (!pendingSessionSelect) {
      return;
    }

    for (const [nodeId, node] of connections) {
      if (node.providerSessionId === pendingSessionSelect) {
        onSelectConnection(nodeId);
        setPendingSessionSelect(null);
        return;
      }
    }
  }, [
    connections,
    pendingSessionSelect,
    onSelectConnection,
    setPendingSessionSelect,
  ]);

  const handleNavigateToParent = useCallback(() => {
    if (!parentInfo) {
      return;
    }
    onSelectConnection(parentInfo.id);
  }, [parentInfo, onSelectConnection]);

  const handleNavigateToSession = useCallback(
    (sessionId: string) => {
      for (const [nodeId, node] of connections) {
        if (node.providerSessionId === sessionId) {
          onSelectConnection(nodeId);
          return;
        }
      }
      console.warn(`[PromptView] Could not find session for ID: ${sessionId}`);
    },
    [connections, onSelectConnection],
  );

  return {
    activeNode,
    parentInfo,
    sessionActionTarget,
    handleNavigateToParent,
    handleNavigateToSession,
  };
}
