import { useCallback, type MutableRefObject } from 'react';
import type { Attachment, SessionNode } from '../types';
import {
  injectWithSessionRecovery,
  buildInjectionSuccessStatus,
} from './provider-injection-flow';

type WithNodeFn = (
  id: string,
  updater: (node: SessionNode) => SessionNode,
) => void;

/** Model override for message injection. */
export interface ModelOverride {
  providerId: string;
  modelId: string;
  variant?: string;
}

/**
 * Find the node key and node for a given sessionId by searching the nodes map.
 * Extracted as a pure function for testability.
 *
 * PRIORITY ORDER (critical for correct routing in parent-child scenarios):
 * 1. Direct map key lookup (node.id === sessionId)
 * 2. Match by providerSessionId field — this is the unique session identifier
 * 3. Match by connectionId field — fallback for legacy/standalone clients
 *
 * In OpenCode's shared MCP client architecture, parent and child sessions share
 * the same connectionId (transport UUID). The providerSessionId is the unique
 * identifier that distinguishes them. Always prioritize providerSessionId.
 */
export function findNodeBySessionId(
  nodes: Map<string, SessionNode>,
  sessionId: string,
): { nodeKey: string | null; node: SessionNode | null } {
  // Priority 1: Direct map key lookup
  if (nodes.has(sessionId)) {
    const node = nodes.get(sessionId)!;
    return { nodeKey: sessionId, node };
  }

  // Priority 2: Match by providerSessionId field
  for (const [id, n] of nodes) {
    if (n.providerSessionId === sessionId) {
      return { nodeKey: id, node: n };
    }
  }

  // Priority 3: Match by connectionId field — RESTRICTED to direct/standalone
  // connections only. OpenCode-backed nodes (which have a providerSessionId)
  // share the same connectionId across parent/child sessions, so a
  // connectionId-only match would corrupt cross-channel routing. Only allow
  // this fallback for nodes that are direct connections or have no
  // providerSessionId set yet.
  for (const [id, n] of nodes) {
    if (
      n.connectionId === sessionId &&
      (n.isDirectConnection || n.providerSessionId === null)
    ) {
      return { nodeKey: id, node: n };
    }
  }

  return { nodeKey: null, node: null };
}

/**
 * Find the node key that contains a message with the given outboundId.
 * This is a fallback for when the session-based lookup fails (e.g., due to
 * timing issues where the node key changed during an async operation).
 */
export function findNodeByOutboundId(
  nodes: Map<string, SessionNode>,
  outboundId: string,
): string | null {
  for (const [id, node] of nodes) {
    if (node.channelMessages.some((m) => m.id === outboundId)) {
      return id;
    }
  }
  return null;
}

/**
 * Returns an `inject` function that:
 * 1. Resolves the provider session via the main-process resolver.
 * 2. Injects the message via the provider HTTP API.
 * 3. On stale-session errors, re-resolves once and retries.
 * 4. Marks the outbound message as `sent`, or appends an error/warning status.
 *
 * `sessionId` here is the MCP connectionId (used as the node lookup key for
 * direct connections, or matched via `node.connectionId` for provider nodes).
 *
 * NOTE: We accept `nodesRef` (a ref to the current nodes map) instead of `nodes`
 * directly to avoid stale closure issues. The caller (useConnections) updates
 * the nodes map via setNodes, and we need to read the *current* value when
 * withNode is called, not the value captured when inject was created.
 */
export function useProviderInjection(
  nodesRef: MutableRefObject<Map<string, SessionNode>>,
  withNode: WithNodeFn,
): {
  inject: (
    sessionId: string,
    outboundId: string,
    message: string,
    attachments?: Attachment[],
    noReply?: boolean,
    modelOverride?: ModelOverride,
    agent?: string,
  ) => Promise<void>;
} {
  const inject = useCallback(
    async (
      sessionId: string,
      outboundId: string,
      message: string,
      attachments?: Attachment[],
      noReply = true,
      modelOverride?: ModelOverride,
      agent?: string,
    ): Promise<void> => {
      console.log('[useProviderInjection] inject() called', {
        sessionId,
        outboundId,
        message,
        messageLength: message.length,
        attachmentsCount: attachments?.length ?? 0,
        noReply,
        modelOverride,
      });

      const providerStatus = await window.api.getProviderStatus();
      console.log('[useProviderInjection] Provider status:', providerStatus);

      // Find the node that owns this connectionId (sessionId).
      // Use nodesRef.current to always get the latest nodes map, avoiding
      // stale closure issues when inject is called immediately after setNodes.
      const { nodeKey, node } = findNodeBySessionId(
        nodesRef.current,
        sessionId,
      );

      console.log('[useProviderInjection] Initial node lookup', {
        sessionId,
        outboundId,
        nodeKey,
        nodeFound: !!node,
        nodesCount: nodesRef.current.size,
        nodeKeys: Array.from(nodesRef.current.keys()),
      });

      const baseDirectory = node?.baseDirectory ?? undefined;
      const connectionId = node?.connectionId ?? sessionId;
      const directProviderSessionId =
        node?.providerType === 'opencode' && node.providerSessionId
          ? node.providerSessionId
          : null;

      /**
       * Helper to get the current node key for updating the message.
       * Re-looks up the node key fresh from nodesRef to handle cases where:
       * 1. The initial lookup failed (node wasn't in map yet)
       * 2. The node key changed during a long async operation
       * Falls back to searching by outboundId if session-based lookup fails.
       */
      const getCurrentNodeKey = (): string | null => {
        // First, try the initial node key if we have it and it still exists
        if (nodeKey && nodesRef.current.has(nodeKey)) {
          return nodeKey;
        }
        // Re-lookup by session ID
        const { nodeKey: freshKey } = findNodeBySessionId(
          nodesRef.current,
          sessionId,
        );
        if (freshKey) {
          console.log(
            '[useProviderInjection] getCurrentNodeKey: found via session lookup',
            freshKey,
          );
          return freshKey;
        }
        // Final fallback: search by outbound message ID
        const outboundKey = findNodeByOutboundId(nodesRef.current, outboundId);
        console.log(
          '[useProviderInjection] getCurrentNodeKey: fallback by outboundId',
          {
            outboundId,
            foundKey: outboundKey,
            nodesCount: nodesRef.current.size,
          },
        );
        return outboundKey;
      };

      if (providerStatus.backend === 'claude_sdk') {
        try {
          const result = await window.api.injectClaudeMessage(
            sessionId,
            message,
            baseDirectory,
            attachments,
          );

          const claudeKey = getCurrentNodeKey();
          if (claudeKey) {
            withNode(claudeKey, (n) => ({
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
          const claudeErrorKey = getCurrentNodeKey();
          if (claudeErrorKey) {
            withNode(claudeErrorKey, (n) => ({
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: false } : m,
              ),
              sessionStatuses: [
                ...n.sessionStatuses,
                {
                  status: `Claude SDK inject error: ${msg}`,
                  type: 'error' as const,
                  timestamp: new Date(),
                },
              ],
            }));
          }
        }
        return;
      }

      // ── Provider session resolution ──────────────────────────────────────
      // If the renderer already resolved a concrete OpenCode session ID for the
      // active node, use it directly. Parent and child OpenCode sessions share
      // the same MCP connectionId, so re-resolving by connectionId can route a
      // parent-targeted send into the child session.
      const resolved = directProviderSessionId
        ? {
            providerSessionId: directProviderSessionId,
            parentSessionId: node?.openCodeParentId ?? null,
            resolvedVia: 'cached' as const,
          }
        : await window.api.resolveSession(connectionId, baseDirectory);

      console.log('[useProviderInjection] Session resolution result', {
        sessionId,
        connectionId,
        directProviderSessionId,
        resolved,
      });

      // Handle ambiguous resolution — surface a warning, don't inject.
      if (resolved.resolvedVia === 'ambiguous') {
        const ambiguousKey = getCurrentNodeKey();
        if (ambiguousKey) {
          withNode(ambiguousKey, (n) => ({
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
        // Fire-and-forget (no await) — IPC round-trip must not block message delivery.
        try {
          if (node?.docContextEnabled !== false) {
            void window.api.injectDocContext?.(
              connectionId,
              null,
              message,
              baseDirectory,
            );
          }
        } catch {
          // Fire-and-forget — doc context failure must not block message delivery
        }
        const noProviderKey = getCurrentNodeKey();
        if (noProviderKey) {
          withNode(noProviderKey, (n) => ({
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
      // Fire-and-forget (no await) — a failure or slow IPC round-trip here
      // must NOT block the user's message from being injected.
      // Skip if the session has doc context injection disabled.
      try {
        if (node?.docContextEnabled !== false) {
          void window.api.injectDocContext?.(
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
        console.log(
          '[useProviderInjection] Calling injectWithSessionRecovery',
          {
            providerSessionId,
            connectionId,
            baseDirectory,
            message,
            noReply,
            timestamp: new Date().toISOString(),
          },
        );

        const startTime = performance.now();
        const result = await injectWithSessionRecovery(
          {
            initialSessionId: providerSessionId,
            connectionId,
            baseDirectory,
          },
          {
            inject: async (sid: string) => {
              console.log(
                '[useProviderInjection] Calling window.api.injectOpenCodeMessage',
                {
                  sid,
                  message,
                  attachmentsCount: attachments?.length ?? 0,
                  noReply,
                  modelOverride,
                  agent,
                  timestamp: new Date().toISOString(),
                },
              );
              const injectStartTime = performance.now();
              const injectResult = (await window.api.injectOpenCodeMessage?.(
                sid,
                message,
                attachments,
                noReply,
                modelOverride,
                agent,
              )) ?? { ok: false, error: 'OpenCode inject bridge unavailable' };
              const injectElapsed = performance.now() - injectStartTime;
              console.log(
                '[useProviderInjection] injectOpenCodeMessage result:',
                {
                  ...injectResult,
                  elapsedMs: Math.round(injectElapsed),
                  timestamp: new Date().toISOString(),
                },
              );
              return injectResult;
            },
            reResolve: async (cid: string, dir?: string) =>
              (await window.api.reResolveSession(cid, dir)) ?? {
                providerSessionId: null,
                parentSessionId: null,
                resolvedVia: 'none' as const,
              },
          },
        );

        const totalElapsed = performance.now() - startTime;
        console.log(
          '[useProviderInjection] injectWithSessionRecovery result:',
          {
            ...result,
            totalElapsedMs: Math.round(totalElapsed),
            timestamp: new Date().toISOString(),
          },
        );

        if (result.ok) {
          const currentKey = getCurrentNodeKey();
          console.log('[useProviderInjection] Injection succeeded', {
            initialNodeKey: nodeKey,
            currentNodeKey: currentKey,
            outboundId,
            resultSessionId: result.sessionId,
          });
          if (currentKey) {
            withNode(currentKey, (n) => ({
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: true } : m,
              ),
              ...(result.sessionId !== providerSessionId
                ? { providerSessionId: result.sessionId }
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

        const failureKey = getCurrentNodeKey();
        console.log('[useProviderInjection] Injection FAILED', {
          initialNodeKey: nodeKey,
          currentNodeKey: failureKey,
          outboundId,
          resultOk: result.ok,
          resultError: result.error,
          resultRetried: result.retried,
        });

        if (failureKey) {
          console.log('[useProviderInjection] Updating message sent=false', {
            failureKey,
            outboundId,
          });
          withNode(failureKey, (n) => {
            const messageFound = n.channelMessages.some(
              (m) => m.id === outboundId,
            );
            console.log('[useProviderInjection] withNode updater for failure', {
              nodeId: n.id,
              messagesCount: n.channelMessages.length,
              outboundId,
              messageFound,
              messageIds: n.channelMessages.slice(-5).map((m) => m.id),
            });
            return {
              ...n,
              channelMessages: n.channelMessages.map((m) =>
                m.id === outboundId ? { ...m, sent: false } : m,
              ),
              ...(result.sessionId !== providerSessionId
                ? { providerSessionId: result.sessionId }
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
            };
          });
        } else {
          console.log(
            '[useProviderInjection] CRITICAL: nodeKey is null, cannot update message!',
            {
              sessionId,
              outboundId,
              nodesCount: nodesRef.current.size,
              nodeKeys: Array.from(nodesRef.current.keys()),
            },
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const errorKey = getCurrentNodeKey();
        console.log('[useProviderInjection] Injection threw error', {
          initialNodeKey: nodeKey,
          currentNodeKey: errorKey,
          outboundId,
          error: msg,
        });
        if (errorKey) {
          withNode(errorKey, (n) => ({
            ...n,
            channelMessages: n.channelMessages.map((m) =>
              m.id === outboundId ? { ...m, sent: false } : m,
            ),
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
    // nodesRef is a stable ref, so we don't need to include it in deps.
    // withNode is the only true dependency here.
    [withNode],
  );

  return { inject };
}
