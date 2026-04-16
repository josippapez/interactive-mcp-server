import { useCallback } from 'react';
import type { SessionNode } from '../../types';
import type { ChannelSelectionSource } from '../../store/channel-selection';

interface UiHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
  withNode: (id: string, updater: (node: SessionNode) => SessionNode) => void;
  selectChannel: (
    id: string | null,
    source: ChannelSelectionSource,
    intentionalNull?: boolean,
  ) => void;
}

export function useUiHandlers({
  nodesRef,
  setNodes,
  withNode,
  selectChannel,
}: UiHandlersOptions) {
  const handleDismissStatus = useCallback(
    (connectionId: string, timestamp: Date) => {
      setNodes((prev) => {
        for (const [id, node] of prev) {
          if (node.connectionId === connectionId || node.id === connectionId) {
            const next = new Map(prev);
            next.set(id, {
              ...node,
              sessionStatuses: node.sessionStatuses.filter(
                (s) => s.timestamp !== timestamp,
              ),
            });
            return next;
          }
        }
        return prev;
      });
    },
    [setNodes],
  );

  const handleToggleDocContext = useCallback(
    (nodeId: string) => {
      withNode(nodeId, (node) => ({
        ...node,
        docContextEnabled: node.docContextEnabled === false ? true : false,
      }));
    },
    [withNode],
  );

  /** Jump focus to the first channel that has a pending prompt, if any. */
  const jumpToFirstPendingPrompt = useCallback(() => {
    for (const [id, node] of nodesRef.current) {
      if (node.hasPendingPrompt || node.pendingQuestions.length > 0) {
        selectChannel(id, 'keyboard-shortcut');
        return;
      }
    }
  }, [nodesRef, selectChannel]);

  return {
    handleDismissStatus,
    handleToggleDocContext,
    jumpToFirstPendingPrompt,
  };
}
