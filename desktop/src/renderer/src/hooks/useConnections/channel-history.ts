import { useCallback } from 'react';
import type { ChannelMessage, SessionNode } from '../../types';
import { useChannelHistory } from '../useChannelHistory';
import { resolveHistoryNodeKey } from './startup-history';

interface UseChannelHistoryLoaderOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
}

/**
 * Hook for loading channel history for a specific connection.
 */
export function useChannelHistoryLoader({
  nodesRef,
  setNodes,
}: UseChannelHistoryLoaderOptions) {
  const { loadHistory } = useChannelHistory();

  /** Load history for a session ID and merge it back into the matching node. */
  const loadChannelHistory = useCallback(
    async (sessionId: string) => {
      // Use ref to avoid re-creating this callback when nodes change
      const currentNodes = nodesRef.current;

      const nodeId =
        resolveHistoryNodeKey(currentNodes, sessionId) ?? sessionId;

      const node = currentNodes.get(nodeId);
      const liveMessages: ChannelMessage[] = node?.channelMessages ?? [];
      const merged = await loadHistory(sessionId, liveMessages);

      setNodes((prev) => {
        // Re-find the node in case the map changed while we were loading
        const key = resolveHistoryNodeKey(prev, sessionId);
        if (!key) return prev;
        const n = prev.get(key)!;
        const next = new Map(prev);
        next.set(key, { ...n, channelMessages: merged });
        return next;
      });
    },
    [nodesRef, setNodes, loadHistory],
  );

  return { loadChannelHistory };
}
