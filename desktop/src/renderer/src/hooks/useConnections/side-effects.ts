import { useEffect } from 'react';
import type { SessionNode } from '../../types';
import type { ChannelSelectionSource } from '../../store/channel-selection';

interface UseSideEffectsOptions {
  nodes: Map<string, SessionNode>;
  activeId: string | null;
  isIntentionalNull: boolean;
  withNode: (id: string, updater: (node: SessionNode) => SessionNode) => void;
  selectChannel: (
    id: string | null,
    source: ChannelSelectionSource,
    intentionalNull?: boolean,
  ) => void;
  loadChannelHistory: (sessionId: string) => Promise<void>;
  loadedHistoryIds: React.MutableRefObject<Set<string>>;
}

export function resolveNodeHistoryLoadId(
  node: SessionNode | null,
): string | null {
  if (!node) return null;

  return (
    node.providerSessionId ??
    node.sessionChannel?.sessionId ??
    node.connectionId
  );
}

export function resolveHistoryLoadId(
  nodes: Map<string, SessionNode>,
  activeId: string | null,
  loadedHistoryIds: ReadonlySet<string>,
): string | null {
  if (!activeId) return null;

  const node = nodes.get(activeId);
  if (!node) return null;

  const historyId = resolveNodeHistoryLoadId(node);
  if (!historyId || loadedHistoryIds.has(historyId)) {
    return null;
  }

  return historyId;
}

/**
 * Hook for side effects related to node selection and unread state.
 */
export function useSideEffects({
  nodes,
  activeId,
  isIntentionalNull,
  withNode,
  selectChannel,
  loadChannelHistory,
  loadedHistoryIds,
}: UseSideEffectsOptions) {
  /** Clear unread count and update lastReadMessageId when switching to a node */
  useEffect(() => {
    if (activeId) {
      withNode(activeId, (node) => {
        // Mark the last message as read when the node becomes active
        const lastMessage =
          node.channelMessages[node.channelMessages.length - 1];
        return {
          ...node,
          unreadCount: 0,
          lastReadMessageId: lastMessage?.id ?? node.lastReadMessageId,
        };
      });
    }
  }, [activeId, withNode]);

  /** Load persisted history lazily when a channel becomes active. */
  useEffect(() => {
    const historyId = resolveHistoryLoadId(
      nodes,
      activeId,
      loadedHistoryIds.current,
    );
    if (!historyId) {
      return;
    }

    loadedHistoryIds.current.add(historyId);
    void loadChannelHistory(historyId);
  }, [activeId, nodes, loadChannelHistory, loadedHistoryIds]);

  /** Auto-select the first available node if active one disappears */
  useEffect(() => {
    // Skip if user intentionally deselected (e.g., to show "new session" view)
    if (isIntentionalNull) return;
    if (activeId !== null && nodes.has(activeId)) return;
    const first = (nodes.keys().next().value as string | undefined) ?? null;
    // Skip the call if both sides would resolve to the same null value.
    // Without this, any `nodes` reference change (even no-op seeds) causes
    // repeated `selectChannel(null, 'auto-select-first')` spam in a tight
    // render loop during session-tree seeding bursts.
    if (activeId === null && first === null) return;
    if (activeId === first) return;
    selectChannel(first, 'auto-select-first');
  }, [nodes, activeId, isIntentionalNull, selectChannel]);
}
