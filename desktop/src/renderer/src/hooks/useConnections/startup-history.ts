import { useCallback } from 'react';
import type { SessionNode } from '../../types';

/**
 * Resolve the node key that should receive persisted history for `sessionId`.
 *
 * Priority:
 * 1) Exact node key match (OpenCode sessions are keyed by providerSessionId)
 * 2) Exact `node.id` match
 * 3) Fallback to `node.connectionId` only when it maps to a single node
 *
 * The uniqueness guard in step (3) prevents cross-session history bleed when
 * OpenCode child sessions share the same MCP transport `connectionId`.
 */
export function resolveHistoryNodeKey(
  nodes: Map<string, SessionNode>,
  sessionId: string,
): string | null {
  if (nodes.has(sessionId)) {
    return sessionId;
  }

  for (const [id, node] of nodes) {
    if (node.id === sessionId) {
      return id;
    }
  }

  let matchKey: string | null = null;
  for (const [id, node] of nodes) {
    if (node.connectionId !== sessionId) {
      continue;
    }
    if (matchKey !== null) {
      return null;
    }
    matchKey = id;
  }

  return matchKey;
}

interface UseStartupHistoryOptions {
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
}

/**
 * Hook for loading persisted channel history on app startup.
 * Also provides a callback to apply buffered history when nodes arrive late.
 */
export function useStartupHistory({ setNodes }: UseStartupHistoryOptions) {
  void setNodes;

  // Channel history is loaded lazily on first activation. Keep the old hook
  // boundary so callers do not need to know about that policy.
  const applyStartupHistoryBuffer = useCallback((_sessionId: string) => {}, []);

  return {
    applyStartupHistoryBuffer,
  };
}
