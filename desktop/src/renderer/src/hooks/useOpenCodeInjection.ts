import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../types';
import {
  shouldDetectSessionForInjection,
  injectWithSessionRecovery,
  buildInjectionSuccessStatus,
  resolveInjectionSessionId,
} from './opencode-injection-flow';

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

      // Resolve the OpenCode session ID to inject into.
      // Always uses the node's own openCodeSessionId so subagent channels
      // route messages directly into the subagent session.
      let openCodeSessionId = resolveInjectionSessionId(node);

      // Lazy detection: only attempt for direct connections with no session ID.
      if (
        shouldDetectSessionForInjection({
          openCodeSessionId,
          isDirectConnection: node?.isDirectConnection ?? false,
        })
      ) {
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

      // Inject relevant doc context (noReply) before the user's message so
      // OpenCode has repo docs in context when it processes the request.
      // This is intentionally fire-and-forget on the error path — a failure
      // here should NOT block the user's message from being injected.
      // Skip if the session has doc context injection disabled.
      try {
        if (node?.docContextEnabled !== false) {
          await window.api.injectDocContext?.(
            sessionId,
            openCodeSessionId,
            message,
            baseDirectory,
          );
        }
      } catch {
        // Doc context injection is best-effort; swallow errors silently.
      }

      try {
        const result = await injectWithSessionRecovery(
          {
            initialSessionId: openCodeSessionId,
            baseDirectory,
          },
          {
            inject: async (sessionId: string) =>
              (await window.api.injectOpenCodeMessage?.(
                sessionId,
                message,
                attachments,
              )) ?? { ok: false, error: 'OpenCode inject bridge unavailable' },
            detect: async (dir?: string) =>
              (await window.api.detectOpenCodeSession?.(dir)) ?? null,
          },
        );
        if (result.ok) {
          if (nodeKey) {
            withNode(nodeKey, (n) => ({
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: true } : m,
              ),
              ...(result.sessionId !== openCodeSessionId
                ? { openCodeSessionId: result.sessionId }
                : {}),
              ...(buildInjectionSuccessStatus(
                result.noReply ?? false,
                result.retried,
              )
                ? {
                    sessionStatuses: [
                      ...n.sessionStatuses,
                      {
                        status: buildInjectionSuccessStatus(
                          result.noReply ?? false,
                          result.retried,
                        )!,
                        type: 'success' as const,
                        timestamp: new Date(),
                      },
                    ],
                  }
                : {}),
            }));
          }
          return;
        }
        if (nodeKey) {
          withNode(nodeKey, (n) => ({
            ...n,
            ...(result.sessionId !== openCodeSessionId
              ? { openCodeSessionId: result.sessionId }
              : {}),
            sessionStatuses: [
              ...n.sessionStatuses,
              ...(result.retried
                ? [
                    {
                      status:
                        'OpenCode session recovered, but inject retry failed',
                      type: 'working' as const,
                      timestamp: new Date(),
                    },
                  ]
                : []),
              {
                status: `OpenCode inject failed: ${result.error ?? 'unknown error'}`,
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
