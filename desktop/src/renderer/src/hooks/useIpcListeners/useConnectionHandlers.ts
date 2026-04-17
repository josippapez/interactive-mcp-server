import type { HandlerContext } from './types';
import { createDirectConnectionNode } from './helpers';

/**
 * Registers IPC listeners for direct-connection lifecycle events.
 * Handles: onConnectionOpened, onConnectionClosed, onChannelLabelUpdated
 */
export function useConnectionHandlers({
  getActiveConnectionId,
  activateRef,
  setNodes,
  selectChannel,
  loadChannelHistory,
  loadedHistoryIds,
  rehydrateActivePrompts,
}: HandlerContext): void {
  // ------------------------------------------------------------------
  // Direct-connection lifecycle (MCP agents with no OpenCode session)
  // ------------------------------------------------------------------
  window.api.onConnectionOpened?.((data) => {
    setNodes((prev) => {
      // If any node already tracks this connectionId, skip.
      for (const node of prev.values()) {
        if (node.connectionId === data.connectionId) return prev;
      }
      const id = data.connectionId;
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(
        id,
        createDirectConnectionNode(
          id,
          data.name,
          data.sessionId
            ? { sessionId: data.sessionId, label: data.label }
            : null,
          data.providerType,
        ),
      );
      return next;
    });
    // Only select if no channel is currently active
    if (!getActiveConnectionId()) {
      selectChannel(data.connectionId, 'connection-opened');
    }
    if (!loadedHistoryIds.current.has(data.connectionId)) {
      loadedHistoryIds.current.add(data.connectionId);
      void loadChannelHistory(data.connectionId);
    }
    void rehydrateActivePrompts();
    activateRef.current();
  });

  window.api.onConnectionClosed?.((data) => {
    setNodes((prev) => {
      const node = prev.get(data.connectionId);
      if (!node?.isDirectConnection) return prev;
      const next = new Map(prev);
      next.delete(data.connectionId);
      return next;
    });
    // Only clear selection if this was the active channel
    if (getActiveConnectionId() === data.connectionId) {
      selectChannel(null, 'connection-closed');
    }
  });

  window.api.onChannelLabelUpdated?.((data) => {
    setNodes((prev) => {
      // Standalone nodes are keyed by connectionId; OpenCode nodes are keyed
      // by providerSessionId. Search by field when the direct key lookup fails.
      let targetKey: string | undefined;

      if (data.providerSessionId && prev.has(data.providerSessionId)) {
        targetKey = data.providerSessionId;
      }

      if (!targetKey && prev.has(data.connectionId)) {
        targetKey = data.connectionId;
      }

      if (!targetKey) {
        for (const [key, node] of prev) {
          if (
            data.providerSessionId &&
            node.providerSessionId === data.providerSessionId
          ) {
            targetKey = key;
            break;
          }
          if (node.connectionId === data.connectionId) {
            targetKey = key;
            break;
          }
        }
      }
      if (!targetKey) return prev;
      const node = prev.get(targetKey)!;
      const next = new Map(prev);
      next.set(targetKey, {
        ...node,
        title: data.name,
        sessionChannel: node.sessionChannel
          ? { ...node.sessionChannel, label: data.name }
          : node.sessionChannel,
      });
      return next;
    });
  });
}
