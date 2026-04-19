import type { SessionNode } from '../../types';

/**
 * Pure helper that removes a session-status entry (matched by timestamp) from
 * whichever node maps to the given identifier. Returns the same Map reference
 * when no matching node is found so React can bail out of a re-render.
 *
 * MATCH PRIORITY (critical for cross-channel routing):
 *   1. Direct node-key match — `prev.get(id)`. Node keys are unique.
 *   2. connectionId fallback — RESTRICTED to direct/standalone nodes only.
 *      OpenCode-backed nodes (which have `providerSessionId !== null` and
 *      `isDirectConnection === false`) share the same MCP `connectionId`
 *      across parent/child sessions, so a connectionId-only match would
 *      dismiss status on the wrong channel.
 */
export function dismissStatus(
  prev: Map<string, SessionNode>,
  id: string,
  timestamp: Date,
): Map<string, SessionNode> {
  // Priority 1: direct node-key match.
  const direct = prev.get(id);
  if (direct) {
    const next = new Map(prev);
    next.set(id, {
      ...direct,
      sessionStatuses: direct.sessionStatuses.filter(
        (s) => s.timestamp !== timestamp,
      ),
    });
    return next;
  }

  // Priority 2: connectionId fallback restricted to direct/standalone nodes.
  for (const [nodeId, node] of prev) {
    if (
      node.connectionId === id &&
      (node.isDirectConnection || node.providerSessionId === null)
    ) {
      const next = new Map(prev);
      next.set(nodeId, {
        ...node,
        sessionStatuses: node.sessionStatuses.filter(
          (s) => s.timestamp !== timestamp,
        ),
      });
      return next;
    }
  }

  return prev;
}
