import { useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';
import { resolveSessionActionTarget } from '../../hooks/remove-session-target';
import { setSessionAgentAtom } from '../../store/session-agents';
import type { SessionNode } from '../../types';
import {
  resolvePendingAgentAssignment,
  type PendingNewSessionAgent,
} from './pending-agent-assignment';

type Args = {
  connections: Map<string, SessionNode>;
  activeConnectionId: string | null;
  connectionId: string | null;
  sessionChannelId: string | null;
  pendingSessionSelect: string | null;
  onSelectConnection: (connectionId: string | null) => void;
  setPendingSessionSelect: (value: string | null) => void;
  pendingNewSessionAgent: PendingNewSessionAgent | null;
  setPendingNewSessionAgent: (value: PendingNewSessionAgent | null) => void;
};

export function usePromptNavigationState({
  connections,
  activeConnectionId,
  connectionId,
  sessionChannelId,
  pendingSessionSelect,
  onSelectConnection,
  setPendingSessionSelect,
  pendingNewSessionAgent,
  setPendingNewSessionAgent,
}: Args) {
  const setSessionAgent = useSetAtom(setSessionAgentAtom);
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
        const assignment = resolvePendingAgentAssignment({
          matchedNodeId: nodeId,
          matchedSessionId: pendingSessionSelect,
          pendingNewSessionAgent,
        });
        if (assignment) {
          setSessionAgent({
            connectionId: assignment.connectionId,
            agent: assignment.agent,
          });
          setPendingNewSessionAgent(null);
        }
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
    pendingNewSessionAgent,
    setPendingNewSessionAgent,
    setSessionAgent,
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
