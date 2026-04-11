import { useCallback } from 'react';
import type { Attachment, SessionNode } from '../types';
import {
  injectWithSessionRecovery,
  buildInjectionSuccessStatus,
} from './provider-injection-flow';

type WithNodeFn = (
  id: string,
  updater: (node: SessionNode) => SessionNode,
) => void;

/**
 * Returns an `inject` function that:
 * 1. Resolves the provider session via the main-process resolver.
 * 2. Injects the message via the provider HTTP API.
 * 3. On stale-session errors, re-resolves once and retries.
 * 4. Marks the outbound message as `sent`, or appends an error/warning status.
 *
 * `sessionId` here is the MCP connectionId (used as the node lookup key for
 * direct connections, or matched via `node.connectionId` for provider nodes).
 */
export function useProviderInjection(
  nodes: Map<string, SessionNode>,
  withNode: WithNodeFn,
): {
  inject: (
    sessionId: string,
    outboundId: string,
    message: string,
    attachments?: Attachment[],
    noReply?: boolean,
  ) => Promise<void>;
} {
  const inject = useCallback(
    async (
      sessionId: string,
      outboundId: string,
      message: string,
      attachments?: Attachment[],
      noReply = true,
    ): Promise<void> => {
      const providerStatus = await window.api.getProviderStatus();

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
      const connectionId = node?.connectionId ?? sessionId;

      if (providerStatus.backend === 'claude_sdk') {
        try {
          const result = await window.api.injectClaudeMessage(
            sessionId,
            message,
            baseDirectory,
            attachments,
          );

          if (nodeKey) {
            withNode(nodeKey, (n) => ({
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: result.ok } : m,
              ),
              sessionStatuses: [
                ...n.sessionStatuses,
                {
                  status: result.ok
                    ? `Claude SDK inject succeeded${result.sessionId ? ` (session: ${result.sessionId.slice(0, 8)}...)` : ''}`
                    : `Claude SDK inject failed: ${result.error ?? 'unknown error'}`,
                  type: result.ok ? 'success' : 'error',
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
                  status: `Claude SDK inject error: ${msg}`,
                  type: 'error',
                  timestamp: new Date(),
                },
              ],
            }));
          }
        }
        return;
      }

      // ── Provider-agnostic session resolution via main-process resolver ──
      const resolved = await window.api.resolveSession(
        connectionId,
        baseDirectory,
      );

      // Handle ambiguous resolution — surface a warning, don't inject.
      if (resolved.resolvedVia === 'ambiguous') {
        if (nodeKey) {
          withNode(nodeKey, (n) => ({
            ...n,
            sessionStatuses: [
              ...n.sessionStatuses,
              {
                status: `Session routing ambiguous: ${resolved.message ?? 'multiple candidates'}. Message queued locally.`,
                type: 'working',
                timestamp: new Date(),
              },
            ],
            // Mark message as sent (it's in the SQLite queue for polling)
            channelMessages: n.channelMessages.map((m) =>
              m.id === outboundId ? { ...m, sent: true } : m,
            ),
          }));
        }
        return;
      }

      const providerSessionId = resolved.providerSessionId;

      if (!providerSessionId) {
        // No provider session — SQLite queue is the delivery. Mark sent immediately.
        // Also inject doc context into the SQLite queue for poll_context_injections delivery.
        try {
          if (node?.docContextEnabled !== false) {
            await window.api.injectDocContext?.(
              connectionId,
              null,
              message,
              baseDirectory,
            );
          }
        } catch {
          // Fire-and-forget — doc context failure must not block message delivery
        }
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
      // the provider has repo docs in context when it processes the request.
      // This is intentionally fire-and-forget on the error path — a failure
      // here should NOT block the user's message from being injected.
      // Skip if the session has doc context injection disabled.
      try {
        if (node?.docContextEnabled !== false) {
          await window.api.injectDocContext?.(
            connectionId,
            providerSessionId,
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
            initialSessionId: providerSessionId,
            connectionId,
            baseDirectory,
          },
          {
            inject: async (sid: string) =>
              (await window.api.injectOpenCodeMessage?.(
                sid,
                message,
                attachments,
                noReply,
              )) ?? { ok: false, error: 'OpenCode inject bridge unavailable' },
            reResolve: async (cid: string, dir?: string) =>
              (await window.api.reResolveSession(cid, dir)) ?? {
                providerSessionId: null,
                parentSessionId: null,
                resolvedVia: 'none' as const,
              },
          },
        );

        if (result.ok) {
          if (nodeKey) {
            withNode(nodeKey, (n) => ({
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: true } : m,
              ),
              ...(result.sessionId !== providerSessionId
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
            ...(result.sessionId !== providerSessionId
              ? { openCodeSessionId: result.sessionId }
              : {}),
            sessionStatuses: [
              ...n.sessionStatuses,
              ...(result.retried
                ? [
                    {
                      status:
                        'Provider session recovered, but inject retry failed',
                      type: 'working' as const,
                      timestamp: new Date(),
                    },
                  ]
                : []),
              {
                status: `Provider inject failed: ${result.error ?? 'unknown error'}`,
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
                status: `Provider inject error: ${msg}`,
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
