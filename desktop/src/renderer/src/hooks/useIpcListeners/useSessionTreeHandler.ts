import {
  resolveNewlyCreatedSessionNodeId,
  shouldAutoSelectNewSession,
} from './auto-select-decision';
import {
  mergeSessionTreeSnapshot,
  upsertOptimisticSessionNode,
} from '../session-tree-merge';
import type { HandlerContext } from './types';

export { resolveNewlyCreatedSessionNodeId } from './auto-select-decision';

/**
 * Registers the IPC listener for session tree updates.
 * Handles: onSessionTreeUpdated
 *
 * Returns a disposer that removes every listener registered here.
 */
export function useSessionTreeHandler({
  getActiveConnectionId,
  getIsIntentionalNullSelection,
  activateRef,
  setNodes,
  selectChannel,
  loadChannelHistory,
  loadedHistoryIds,
  applyStartupHistoryBuffer,
  applyStartupPromptBuffer,
  applyStartupPermissionBuffer,
  applyStartupQuestionBuffer,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  disposers.push(
    window.api.onOptimisticSessionNodeCreated?.((node) => {
      setNodes((prev) => upsertOptimisticSessionNode(prev, node));
    }),
  );

  // ------------------------------------------------------------------
  // session-tree-updated — full snapshot from main process.
  // Merges topology; preserves live runtime state.
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onSessionTreeUpdated?.((snapshotNodes) => {
      setNodes((prev) => {
        const candidate = resolveNewlyCreatedSessionNodeId(prev, snapshotNodes);
        const next = mergeSessionTreeSnapshot(prev, snapshotNodes);

        // Load history once per providerSessionId for any newly-connected nodes.
        // Also drain any startup-buffered history and prompts for nodes that just
        // appeared. We key on providerSessionId (not connectionId) because the
        // channel-history DB is keyed by providerSessionId, and a single MCP
        // transport (connectionId) is shared across an OpenCode parent + all
        // child agents — keying on connectionId here causes cross-channel bleed
        // and skips siblings after the first load. (Bug A fix #5)
        for (const snap of snapshotNodes) {
          // Apply buffered prompts for this session (uses providerSessionId)
          applyStartupPromptBuffer(snap.providerSessionId, snap.connectionId);
          applyStartupPermissionBuffer(
            snap.providerSessionId,
            snap.connectionId,
          );
          applyStartupQuestionBuffer(snap.providerSessionId, snap.connectionId);

          const historyKey = snap.providerSessionId;
          if (historyKey) {
            // Drain startup buffer first (no-op if nothing buffered)
            applyStartupHistoryBuffer(historyKey);
            if (!loadedHistoryIds.current.has(historyKey)) {
              loadedHistoryIds.current.add(historyKey);
              void loadChannelHistory(historyKey);
            }
          }
        }

        // Do not steal focus from a currently active channel, and do not
        // override a deliberate user deselection (e.g., the "+ New Session"
        // idle view). User-entered messages route through the active channel
        // selection.
        if (
          shouldAutoSelectNewSession({
            candidate,
            activeChannelId: getActiveConnectionId(),
            isIntentionalNullSelection: getIsIntentionalNullSelection(),
          })
        ) {
          selectChannel(candidate!.sessionId, 'connection-opened');
          activateRef.current();
        }

        return next;
      });
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
