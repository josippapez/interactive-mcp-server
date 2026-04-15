import { useCallback, useEffect, useRef } from 'react';
import type { ChannelMessage, SessionNode } from '../../types';
import { parseDbMessage, mergeMessages } from './message-utils';
import type { StartupHistoryBuffer } from './types';

/**
 * Resolve the node key that should receive persisted history for `sessionId`.
 *
 * Priority:
 * 1) Exact node key match (OpenCode sessions are keyed by openCodeSessionId)
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
  const startupHistoryBuffer = useRef<StartupHistoryBuffer>(new Map());

  // ---------------------------------------------------------------------------
  // Startup — load history for all persisted channels immediately on mount.
  // This runs independently of the OpenCode session-tree so history appears
  // even when OpenCode is not running. If the node doesn't exist yet (it
  // arrives via the session-tree snapshot later), the history is buffered
  // in a ref and applied once the node appears.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const channels = await window.api.getPersistedSessionChannels?.();
      if (!channels || cancelled) return;

      await Promise.all(
        channels.map(async (ch) => {
          const records = await window.api.getSessionChannelHistory?.(
            ch.sessionId,
          );
          if (!records || records.length === 0 || cancelled) return;

          const dbMessages: ChannelMessage[] = records.map(parseDbMessage);

          setNodes((prev) => {
            const key = resolveHistoryNodeKey(prev, ch.sessionId);
            if (!key) {
              // Node not in map yet — store in buffer to apply when it arrives
              startupHistoryBuffer.current.set(ch.sessionId, dbMessages);
              return prev;
            }
            const n = prev.get(key)!;
            const merged = mergeMessages(dbMessages, n.channelMessages);
            const next = new Map(prev);
            next.set(key, { ...n, channelMessages: merged });
            return next;
          });
        }),
      );
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [setNodes]);

  // When new nodes arrive via the session-tree snapshot, apply any buffered
  // startup history that couldn't be applied earlier (node didn't exist yet).
  const applyStartupHistoryBuffer = useCallback(
    (sessionId: string) => {
      const buffered = startupHistoryBuffer.current.get(sessionId);
      if (!buffered || buffered.length === 0) return;
      startupHistoryBuffer.current.delete(sessionId);

      setNodes((prev) => {
        const key = resolveHistoryNodeKey(prev, sessionId);
        if (!key) return prev;
        const n = prev.get(key)!;
        const merged = mergeMessages(buffered, n.channelMessages);
        const next = new Map(prev);
        next.set(key, { ...n, channelMessages: merged });
        return next;
      });
    },
    [setNodes],
  );

  return {
    applyStartupHistoryBuffer,
  };
}
