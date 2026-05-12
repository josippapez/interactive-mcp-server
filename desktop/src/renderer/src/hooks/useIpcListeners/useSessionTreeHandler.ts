import {
  resolveNewlyCreatedSessionNodeId,
  shouldAutoSelectNewSession,
} from './auto-select-decision';
import { mergeSessionTreeSnapshot } from '../session-tree-merge';
import type { HandlerContext } from './types';

export { resolveNewlyCreatedSessionNodeId } from './auto-select-decision';

/**
 * Registers the IPC listener for session tree invalidations.
 * Handles: onSessionTreeInvalidated
 *
 * On invalidation (or on mount), the renderer pulls the current tree via
 * `window.api.getSessionTree()` and merges it into local state. Overlapping
 * fetches are coalesced via an `isFetching` ref plus a `pendingRefetch`
 * flag so at most one fetch is in flight at a time, and any invalidation
 * that arrives during a fetch triggers a single follow-up refresh.
 *
 * Returns a disposer that removes every listener registered here.
 */
export function useSessionTreeHandler({
  getActiveConnectionId,
  getIsIntentionalNullSelection,
  activateRef,
  setNodes,
  selectChannel,
  applyStartupPromptBuffer,
  applyStartupPermissionBuffer,
  applyStartupQuestionBuffer,
  rehydratePendingQuestions,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  // Coalesce overlapping fetches. If an invalidation arrives while a
  // fetch is in flight, we don't start a new fetch — we just set
  // `pendingRefetch` so that one follow-up fetch runs after the current
  // one resolves. This collapses bursts of invalidations into at most
  // two sequential fetches.
  let isFetching = false;
  let pendingRefetch = false;

  const applySnapshot = (
    snapshotNodes: Parameters<typeof mergeSessionTreeSnapshot>[1],
  ): void => {
    // Track candidate for auto-selection before updating state
    let candidateForSelection: ReturnType<
      typeof resolveNewlyCreatedSessionNodeId
    > = null as ReturnType<typeof resolveNewlyCreatedSessionNodeId>;

    setNodes((prev) => {
      candidateForSelection = resolveNewlyCreatedSessionNodeId(
        prev,
        snapshotNodes,
      );
      return mergeSessionTreeSnapshot(prev, snapshotNodes);
    });

    // Apply buffered prompts, permissions, and questions AFTER the state
    // update completes. Using queueMicrotask ensures the setNodes calls
    // inside these functions see the newly merged nodes. Without this,
    // nested setNodes calls would see the pre-merge state and fail to
    // find newly created nodes, causing prompts to be buffered indefinitely.
    queueMicrotask(() => {
      for (const snap of snapshotNodes) {
        applyStartupPromptBuffer(snap.providerSessionId, snap.connectionId);
        applyStartupPermissionBuffer(snap.providerSessionId, snap.connectionId);
        applyStartupQuestionBuffer(snap.providerSessionId, snap.connectionId);
      }
      void rehydratePendingQuestions();
    });

    // Do not steal focus from a currently active channel, and do not
    // override a deliberate user deselection (e.g., the "+ New Session"
    // idle view). User-entered messages route through the active channel
    // selection.
    if (
      candidateForSelection &&
      shouldAutoSelectNewSession({
        candidate: candidateForSelection,
        activeChannelId: getActiveConnectionId(),
        isIntentionalNullSelection: getIsIntentionalNullSelection(),
      })
    ) {
      selectChannel(candidateForSelection.sessionId, 'connection-opened');
      activateRef.current();
    }
  };

  const fetchAndApply = (): void => {
    if (isFetching) {
      // Already fetching — request a follow-up once the current fetch
      // completes so the latest invalidation is not lost.
      pendingRefetch = true;
      return;
    }
    const fetcher = window.api.getSessionTree?.();
    if (!fetcher) return;
    isFetching = true;
    void Promise.resolve(fetcher)
      .then((snapshotNodes) => {
        if (snapshotNodes === null || snapshotNodes === undefined) {
          // Main signals null only on REST fetch failure (typically a
          // cold-start race where OpenCode has not bound its port yet).
          // Schedule a bounded retry chain so the user does not have to
          // click Refresh manually. Stops once any non-null snapshot lands
          // or after RETRY_DELAYS_MS is exhausted; SSE invalidations will
          // catch up later anyway.
          scheduleRetry();
          return;
        }
        cancelPendingRetry();
        applySnapshot(snapshotNodes);
      })
      .finally(() => {
        isFetching = false;
        if (pendingRefetch) {
          pendingRefetch = false;
          fetchAndApply();
        }
      });
  };

  const RETRY_DELAYS_MS = [250, 500, 1000];
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelPendingRetry = (): void => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryAttempt = 0;
  };

  const scheduleRetry = (): void => {
    if (retryAttempt >= RETRY_DELAYS_MS.length) return;
    if (retryTimer !== null) return;
    const delay = RETRY_DELAYS_MS[retryAttempt];
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      fetchAndApply();
    }, delay);
  };

  // ------------------------------------------------------------------
  // session-tree-invalidated — main process signals that its in-memory
  // tree changed. Renderer pulls the latest via getSessionTree().
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onSessionTreeInvalidated?.(() => {
      fetchAndApply();
    }),
  );

  // Initial fetch on mount so the tree is populated on first render.
  fetchAndApply();

  return () => {
    cancelPendingRetry();
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
