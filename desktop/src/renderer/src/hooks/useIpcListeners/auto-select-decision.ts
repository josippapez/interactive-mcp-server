/**
 * Pure decision helpers for the session-tree snapshot auto-select behaviour.
 *
 * Extracted from useSessionTreeHandler so the rules can be unit-tested without
 * React, IPC, or Jotai. Two responsibilities:
 *
 * 1. `resolveNewlyCreatedSessionNodeId` — pick the truly newest snapshot node
 *    (by `createdAt`) that is not present in the previous map. Falls back to
 *    last-iterated when timestamps are missing/equal so behaviour is stable.
 * 2. `shouldAutoSelectNewSession` — guard the focus-stealing branch so it
 *    NEVER fires while the user has intentionally deselected (e.g., opened
 *    the "+ New Session" idle view).
 */
import type { SnapshotNode } from '../session-tree-merge';

export type NewSessionCandidate = {
  sessionId: string;
  hasConnectedChannel: boolean;
  createdAt: number;
};

/**
 * Pick the newest snapshot node not already present in `prev`. "Newest" is
 * determined by `createdAt` (descending). If multiple candidates share the
 * same `createdAt` (or all are missing it), the last-iterated wins so the
 * function remains deterministic for a given snapshot order.
 */
export function resolveNewlyCreatedSessionNodeId(
  prev: Map<string, { id: string }>,
  snapshotNodes: SnapshotNode[],
): NewSessionCandidate | null {
  let best: NewSessionCandidate | null = null;
  for (const snap of snapshotNodes) {
    if (prev.has(snap.providerSessionId)) continue;
    const createdAt = snap.createdAt ?? 0;
    if (best === null || createdAt >= best.createdAt) {
      best = {
        sessionId: snap.providerSessionId,
        hasConnectedChannel: snap.hasMcpChannel,
        createdAt,
      };
    }
  }
  return best;
}

/**
 * Decide whether the snapshot listener should focus a freshly-discovered
 * session. Only true when:
 *   - we found a newly-created candidate AND
 *   - that candidate has an MCP channel attached AND
 *   - no channel is currently active AND
 *   - the user did NOT intentionally clear the selection (e.g., "+ New
 *     Session" view is open).
 */
export function shouldAutoSelectNewSession(args: {
  candidate: NewSessionCandidate | null;
  activeChannelId: string | null;
  isIntentionalNullSelection: boolean;
}): boolean {
  const { candidate, activeChannelId, isIntentionalNullSelection } = args;
  if (!candidate) return false;
  if (!candidate.hasConnectedChannel) return false;
  if (activeChannelId !== null) return false;
  if (isIntentionalNullSelection) return false;
  return true;
}
