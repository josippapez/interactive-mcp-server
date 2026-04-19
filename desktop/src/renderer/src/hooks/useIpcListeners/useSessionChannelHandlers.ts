import type { HandlerContext } from './types';
import { findKeyByConnectionId, collectDescendantKeys } from './helpers';

/**
 * Registers IPC listeners for session channel events.
 * Handles: onSessionChannelDeleted, onSessionChannelMessagesCleared, onDatabaseReset
 */
export function useSessionChannelHandlers({
  getActiveConnectionId,
  setNodes,
  selectChannel,
  clearAllNodes,
}: HandlerContext): void {
  // ------------------------------------------------------------------
  // Session channel events
  // ------------------------------------------------------------------
  window.api.onSessionChannelDeleted?.((data) => {
    // Track the resolved map key so selectChannel can clear it correctly.
    let deletedKey: string | null = null;
    let deletedOcId: string | null = null;

    setNodes((prev) => {
      // Resolve the primary key to delete.
      // `data.sessionId` is the channel's session_id, which IS the
      // providerSessionId for OpenCode-backed channels (see getActiveSessionChannels).
      // Pass it as providerSessionId so the helper matches by that field rather
      // than falling back to the shared connectionId scan. (Bug A fix #4)
      const key: string | null = prev.has(data.sessionId)
        ? data.sessionId
        : findKeyByConnectionId(prev, data.sessionId, data.sessionId);
      if (!key) return prev;

      deletedKey = key;
      const deletedNode = prev.get(key);
      // Prefer the node's providerSessionId for child lookup; fall back to
      // the map key (which IS the providerSessionId for OC-backed nodes).
      deletedOcId = deletedNode?.providerSessionId ?? key;

      // Collect descendants so the entire subtree is removed at once.
      const descendantKeys = collectDescendantKeys(prev, deletedOcId);

      const next = new Map(prev);
      next.delete(key);
      for (const dk of descendantKeys) {
        next.delete(dk);
      }
      return next;
    });

    // Only clear selection if this was the active channel
    if (deletedKey !== null && getActiveConnectionId() === deletedKey) {
      selectChannel(null, 'session-deleted');
    }
  });

  window.api.onSessionChannelMessagesCleared?.((data) => {
    setNodes((prev) => {
      // Check direct connection first
      const direct = prev.get(data.sessionId);
      if (direct) {
        const next = new Map(prev);
        next.set(data.sessionId, {
          ...direct,
          channelMessages: [],
          unreadCount: 0,
          lastReadMessageId: null,
        });
        return next;
      }
      // OpenCode session keyed by providerSessionId.
      // `data.sessionId` is the channel's session_id which IS the
      // providerSessionId; pass it as providerSessionId so the helper avoids
      // the shared-connectionId fallback scan. (Bug A fix #4)
      const nodeId = findKeyByConnectionId(
        prev,
        data.sessionId,
        data.sessionId,
      );
      if (!nodeId) return prev;
      const next = new Map(prev);
      next.set(nodeId, {
        ...prev.get(nodeId)!,
        channelMessages: [],
        unreadCount: 0,
        lastReadMessageId: null,
      });
      return next;
    });
  });

  window.api.onDatabaseReset?.(() => {
    clearAllNodes();
    selectChannel(null, 'initial-load');
  });
}
