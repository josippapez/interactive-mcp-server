import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../types';

type WithNodeFn = (
  id: string,
  updater: (node: SessionNode) => SessionNode,
) => void;

/**
 * Returns an `inject` function that:
 * 1. Resolves the OpenCode session ID from the node (or detects it lazily).
 * 2. Injects the message via the OpenCode noReply HTTP API.
 * 3. Marks the outbound message as `sent`, or appends an error status.
 *
 * `sessionId` here is the MCP connectionId (used as the node lookup key for
 * direct connections, or matched via `node.connectionId` for OpenCode nodes).
 */
export function useOpenCodeInjection(
  nodes: Map<string, SessionNode>,
  withNode: WithNodeFn,
): {
  inject: (
    sessionId: string,
    outboundId: string,
    message: string,
    attachments?: Attachment[],
  ) => Promise<void>;
} {
  const inject = useCallback(
    async (
      sessionId: string,
      outboundId: string,
      message: string,
      attachments?: Attachment[],
    ): Promise<void> => {
      // Find the node that owns this connectionId (sessionId)
      let nodeKey: string | null = null;
      let node: SessionNode | null = null;
      for (const [id, n] of nodes) {
        if (n.connectionId === sessionId || n.id === sessionId) {
          nodeKey = id;
          node = n;
          break;
        }
      }

      const baseDirectory = node?.baseDirectory ?? undefined;

      // OpenCode session ID is the node's openCodeSessionId (already known for
      // OpenCode-backed sessions; null for direct connections).
      let openCodeSessionId = node?.openCodeSessionId ?? null;

      // Lazy detection: only attempt for direct connections with no session ID.
      if (!openCodeSessionId && !node?.isDirectConnection) {
        openCodeSessionId =
          (await window.api.detectOpenCodeSession?.(baseDirectory)) ?? null;
      }

      if (!openCodeSessionId) {
        // No OpenCode session — SQLite queue is the delivery. Mark sent immediately.
        if (nodeKey) {
          withNode(nodeKey, (n) => ({
            ...n,
            channelMessages: n.channelMessages.map((m) =>
              m.id === outboundId ? { ...m, sent: true } : m,
            ),
          }));
        }
        return;
      }

      try {
        const result = await window.api.injectOpenCodeMessage?.(
          openCodeSessionId,
          message,
          attachments,
        );
        if (result?.ok) {
          if (nodeKey) {
            withNode(nodeKey, (n) => ({
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: true } : m,
              ),
            }));
          }
          return;
        }
        if (nodeKey) {
          withNode(nodeKey, (n) => ({
            ...n,
            sessionStatuses: [
              ...n.sessionStatuses,
              {
                status: `OpenCode inject failed: ${result?.error ?? 'unknown error'}`,
                type: 'error' as const,
                timestamp: new Date(),
              },
            ],
          }));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (nodeKey) {
          withNode(nodeKey, (n) => ({
            ...n,
            sessionStatuses: [
              ...n.sessionStatuses,
              {
                status: `OpenCode inject error: ${msg}`,
                type: 'error' as const,
                timestamp: new Date(),
              },
            ],
          }));
        }
      }
    },
    [nodes, withNode],
  );

  return { inject };
}
