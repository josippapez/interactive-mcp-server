import {
  mergeSessionTreeSnapshot,
  upsertOptimisticSessionNode,
  type SnapshotNode,
} from '../session-tree-merge';
import type { HandlerContext } from './types';

export function resolveNewlyCreatedSessionNodeId(
  prev: Map<string, { id: string }>,
  snapshotNodes: SnapshotNode[],
): { sessionId: string; hasConnectedChannel: boolean } | null {
  let newestSessionNodeId: string | null = null;
  let hasConnectedChannel = false;
  for (const snap of snapshotNodes) {
    if (prev.has(snap.openCodeSessionId)) continue;
    newestSessionNodeId = snap.openCodeSessionId;
    if (snap.hasMcpChannel) {
      hasConnectedChannel = true;
    }
  }
  if (!newestSessionNodeId) return null;
  return { sessionId: newestSessionNodeId, hasConnectedChannel };
}

/**
 * Registers the IPC listener for session tree updates.
 * Handles: onSessionTreeUpdated
 */
export function useSessionTreeHandler({
  getActiveConnectionId,
  activateRef,
  setNodes,
  selectChannel,
  loadChannelHistory,
  loadedHistoryIds,
  applyStartupHistoryBuffer,
  applyStartupPromptBuffer,
  applyStartupPermissionBuffer,
  applyStartupQuestionBuffer,
}: HandlerContext): void {
  window.api.onOptimisticSessionNodeCreated?.((node) => {
    setNodes((prev) => upsertOptimisticSessionNode(prev, node));
  });

  // ------------------------------------------------------------------
  // session-tree-updated — full snapshot from main process.
  // Merges topology; preserves live runtime state.
  // ------------------------------------------------------------------
  window.api.onSessionTreeUpdated?.((snapshotNodes) => {
    setNodes((prev) => {
      const newestSessionNode = resolveNewlyCreatedSessionNodeId(
        prev,
        snapshotNodes,
      );
      const next = mergeSessionTreeSnapshot(prev, snapshotNodes);

      // Load history once per connectionId for any newly-connected nodes.
      // Also drain any startup-buffered history and prompts for nodes that just appeared.
      for (const snap of snapshotNodes) {
        // Apply buffered prompts for this session (uses openCodeSessionId)
        applyStartupPromptBuffer(snap.openCodeSessionId, snap.connectionId);
        applyStartupPermissionBuffer(snap.openCodeSessionId, snap.connectionId);
        applyStartupQuestionBuffer(snap.openCodeSessionId, snap.connectionId);

        if (snap.connectionId) {
          // Drain startup buffer first (no-op if nothing buffered)
          applyStartupHistoryBuffer(snap.connectionId);
          if (!loadedHistoryIds.current.has(snap.connectionId)) {
            loadedHistoryIds.current.add(snap.connectionId);
            void loadChannelHistory(snap.connectionId);
          }
        }
      }

      // Do not steal focus from a currently active channel. User-entered
      // messages route through the active channel selection.
      if (
        newestSessionNode &&
        newestSessionNode.hasConnectedChannel &&
        !getActiveConnectionId()
      ) {
        selectChannel(newestSessionNode.sessionId, 'connection-opened');
        activateRef.current();
      }

      return next;
    });

  });
}
