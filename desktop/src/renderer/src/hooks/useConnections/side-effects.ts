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

  /** Auto-select the first available node if active one disappears */
  useEffect(() => {
    // Skip if user intentionally deselected (e.g., to show "new session" view)
    if (isIntentionalNull) return;
    if (activeId !== null && nodes.has(activeId)) return;
    const first = nodes.keys().next().value as string | undefined;
    selectChannel(first ?? null, 'auto-select-first');
  }, [nodes, activeId, isIntentionalNull, selectChannel]);
}
