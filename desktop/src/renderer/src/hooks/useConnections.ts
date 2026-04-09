import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment, SessionNode } from '../types';
import { getRemoveSessionTarget } from './remove-session-target';
import { useChannelHistory } from './useChannelHistory';
import { useIpcListeners } from './useIpcListeners';
import { useProviderInjection } from './useProviderInjection';

export function useConnections(onActivatePromptTab: () => void) {
  // ---------------------------------------------------------------------------
  // State — map key is `node.id` (openCodeSessionId or direct connectionId)
  // ---------------------------------------------------------------------------

  const [nodes, setNodes] = useState<Map<string, SessionNode>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<
    { model?: string; mode?: string } | undefined
  >();

  // Stable refs
  const activateRef = useRef(onActivatePromptTab);
  activateRef.current = onActivatePromptTab;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // ---------------------------------------------------------------------------
  // Core helper — update one node by map key
  // ---------------------------------------------------------------------------

  const withNode = useCallback(
    (id: string, updater: (node: SessionNode) => SessionNode) => {
      setNodes((prev) => {
        const node = prev.get(id);
        if (!node) return prev;
        const next = new Map(prev);
        next.set(id, updater(node));
        return next;
      });
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Sub-hooks
  // ---------------------------------------------------------------------------

  const { loadHistory } = useChannelHistory();

  /** Load history for a connectionId and merge it back into the matching node. */
  const loadChannelHistory = useCallback(
    async (connectionId: string) => {
      // Use ref to avoid re-creating this callback when nodes change
      const currentNodes = nodesRef.current;

      // Find the node that owns this connectionId
      const nodeId = (() => {
        for (const [id, node] of currentNodes) {
          if (node.connectionId === connectionId || node.id === connectionId)
            return id;
        }
        return connectionId; // fallback for direct connections
      })();

      const node = currentNodes.get(nodeId);
      const liveMessages = node?.channelMessages ?? [];
      const merged = await loadHistory(connectionId, liveMessages);

      setNodes((prev) => {
        // Re-find the node in case the map changed while we were loading
        let key: string | null = null;
        for (const [id, n] of prev) {
          if (n.connectionId === connectionId || n.id === connectionId) {
            key = id;
            break;
          }
        }
        if (!key) return prev;
        const n = prev.get(key)!;
        const next = new Map(prev);
        next.set(key, { ...n, channelMessages: merged });
        return next;
      });
    },
    [loadHistory],
  );

  // ---------------------------------------------------------------------------
  // Startup — load history for all persisted channels immediately on mount.
  // This runs independently of the OpenCode session-tree so history appears
  // even when OpenCode is not running. If the node doesn't exist yet (it
  // arrives via the session-tree snapshot later), the history is buffered
  // in a ref and applied once the node appears.
  // ---------------------------------------------------------------------------

  const startupHistoryBuffer = useRef<
    Map<string, import('../types').ChannelMessage[]>
  >(new Map());

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

          const dbMessages = records.map((r) => ({
            id: `db-${r.id}`,
            kind: r.messageType as import('../types').ChannelMessage['kind'],
            text: r.messageText,
            timestamp: (() => {
              const v = r.createdAt;
              const normalized = v.includes('T') ? v : v.replace(' ', 'T');
              const parsed = new Date(
                normalized.endsWith('Z') ? normalized : `${normalized}Z`,
              );
              return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
            })(),
            attachments: r.attachments
              ? (() => {
                  try {
                    return JSON.parse(
                      r.attachments,
                    ) as import('../types').Attachment[];
                  } catch {
                    return undefined;
                  }
                })()
              : undefined,
          }));

          setNodes((prev) => {
            // Find the node that owns this connectionId
            let key: string | null = null;
            for (const [id, n] of prev) {
              if (n.connectionId === ch.sessionId || n.id === ch.sessionId) {
                key = id;
                break;
              }
            }
            if (!key) {
              // Node not in map yet — store in buffer to apply when it arrives
              startupHistoryBuffer.current.set(ch.sessionId, dbMessages);
              return prev;
            }
            const n = prev.get(key)!;
            // Merge: DB messages are authoritative; deduplicate live messages
            const liveIds = new Set(
              dbMessages.map((m) => `${m.kind}::${m.text}`),
            );
            const dedupedLive = n.channelMessages.filter(
              (m) => !liveIds.has(`${m.kind}::${m.text}`),
            );
            const merged = [...dbMessages, ...dedupedLive].sort(
              (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
            );
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
  }, []);

  const clearAllNodes = useCallback(() => {
    setNodes(new Map());
  }, []);

  // ---------------------------------------------------------------------------
  // Startup — recover any prompts that arrived while the renderer was restarting.
  // Main-process memory (activePrompts map) survives renderer restarts; we ask
  // for the live set on mount and inject them into matching nodes.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const activePrompts = await window.api.getActivePrompts?.();
      if (!activePrompts || activePrompts.length === 0 || cancelled) return;

      for (const promptData of activePrompts) {
        // Skip prompts that have already expired.
        if (promptData.expiresAt > 0 && Date.now() >= promptData.expiresAt) {
          continue;
        }

        setNodes((prev) => {
          let nodeId: string | null = null;
          for (const [id, node] of prev) {
            if (node.connectionId === promptData.connectionId) {
              nodeId = id;
              break;
            }
          }
          if (!nodeId) return prev;
          const node = prev.get(nodeId)!;
          // Don't overwrite a fresher prompt that's already in state.
          if (node.prompt && node.prompt.id !== promptData.id) return prev;
          const next = new Map(prev);
          next.set(nodeId, {
            ...node,
            prompt: promptData,
            hasPendingPrompt: true,
            baseDirectory: promptData.baseDirectory ?? node.baseDirectory,
          });
          return next;
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // When new nodes arrive via the session-tree snapshot, apply any buffered
  // startup history that couldn't be applied earlier (node didn't exist yet).
  const applyStartupHistoryBuffer = useCallback((connectionId: string) => {
    const buffered = startupHistoryBuffer.current.get(connectionId);
    if (!buffered || buffered.length === 0) return;
    startupHistoryBuffer.current.delete(connectionId);

    setNodes((prev) => {
      let key: string | null = null;
      for (const [id, n] of prev) {
        if (n.connectionId === connectionId || n.id === connectionId) {
          key = id;
          break;
        }
      }
      if (!key) return prev;
      const n = prev.get(key)!;
      const liveIds = new Set(buffered.map((m) => `${m.kind}::${m.text}`));
      const dedupedLive = n.channelMessages.filter(
        (m) => !liveIds.has(`${m.kind}::${m.text}`),
      );
      const merged = [...buffered, ...dedupedLive].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );
      const next = new Map(prev);
      next.set(key, { ...n, channelMessages: merged });
      return next;
    });
  }, []);

  useIpcListeners({
    activeConnectionRef: activeIdRef,
    activateRef,
    setNodes,
    setActiveId,
    setClientInfo,
    withNode,
    clearAllNodes,
    loadChannelHistory,
    applyStartupHistoryBuffer,
  });

  const { inject } = useProviderInjection(nodes, withNode);

  // ---------------------------------------------------------------------------
  // Side-effects
  // ---------------------------------------------------------------------------

  /** Clear unread count when switching to a node */
  useEffect(() => {
    if (activeId) {
      withNode(activeId, (node) => ({ ...node, unreadCount: 0 }));
    }
  }, [activeId, withNode]);

  /** Auto-select the first available node if active one disappears */
  useEffect(() => {
    if (activeId !== null && nodes.has(activeId)) return;
    const first = nodes.keys().next().value as string | undefined;
    setActiveId(first ?? null);
  }, [nodes, activeId]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeNode = activeId ? (nodes.get(activeId) ?? null) : null;

  // Legacy shape — PromptView and App.tsx still use `connections` / `activeConn`
  // so we expose aliased names alongside the new ones.
  const connections = nodes;
  const activeConnectionId = activeId;
  const setActiveConnectionId = setActiveId;
  const activeConn = activeNode;

  // ---------------------------------------------------------------------------
  // User-action handlers
  // ---------------------------------------------------------------------------

  const handleDismissStatus = useCallback(
    (connectionId: string, timestamp: Date) => {
      setNodes((prev) => {
        for (const [id, node] of prev) {
          if (node.connectionId === connectionId || node.id === connectionId) {
            const next = new Map(prev);
            next.set(id, {
              ...node,
              sessionStatuses: node.sessionStatuses.filter(
                (s) => s.timestamp !== timestamp,
              ),
            });
            return next;
          }
        }
        return prev;
      });
    },
    [],
  );

  const handleSubmit = useCallback(
    (answer: string, attachments?: Attachment[]) => {
      // Always read activeId from the ref (not the closure) so we get the
      // freshest channel at call-time. This prevents two classes of stale
      // closure bugs:
      // 1. A prompt-clear IPC zeroing activeNode.prompt before the user clicks Send.
      // 2. activeId still pointing at the parent session when the user is
      //    replying to a subagent's prompt — which would route doc-context
      //    injection into the parent's OpenCode session instead of the subagent's.
      const currentId = activeIdRef.current;
      const currentNode = currentId
        ? (nodesRef.current.get(currentId) ?? null)
        : null;
      if (!currentNode?.prompt) return;

      // Clear the prompt and append the answer message.
      // Use setNodes directly here (rather than appendAnswerMessage via withNode)
      // so we can do a resilient lookup: if the node was absorbed into an
      // OpenCode session tree entry since we last rendered (direct-connection →
      // tree node promotion), its map key may have changed from connectionId to
      // openCodeSessionId. A fallback search by connectionId prevents the clear
      // from silently no-oping and leaving the prompt UI stuck.
      const nodeConnectionId = currentNode.connectionId;
      setNodes((prev) => {
        // Primary lookup — the map key we expect.
        let key: string | null = prev.has(currentNode.id)
          ? currentNode.id
          : null;
        // Fallback: search by connectionId (handles direct→tree absorption).
        if (!key && nodeConnectionId) {
          for (const [k, n] of prev) {
            if (n.connectionId === nodeConnectionId) {
              key = k;
              break;
            }
          }
        }
        if (!key) return prev;
        const node = prev.get(key)!;
        const next = new Map(prev);
        next.set(key, {
          ...node,
          channelMessages: [
            ...node.channelMessages,
            {
              id: `local-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              kind: 'answer' as const,
              text: answer,
              timestamp: new Date(),
              attachments,
            },
          ],
          prompt: null,
          hasPendingPrompt: false,
        });
        return next;
      });

      // Also update activeId to point at the (possibly new) map key so the
      // channel stays visible after the promotion.
      if (!nodesRef.current.has(currentNode.id) && nodeConnectionId) {
        for (const [k, n] of nodesRef.current) {
          if (n.connectionId === nodeConnectionId) {
            setActiveId(k);
            break;
          }
        }
      }

      // Inject relevant doc context into the provider session before the
      // prompt response so the agent receives repo docs in its context window.
      // Uses the node's in-memory openCodeSessionId (kept in sync by the
      // main-process resolver via the DB).
      const {
        openCodeSessionId,
        connectionId,
        docContextEnabled,
        baseDirectory,
      } = currentNode;
      if (openCodeSessionId && connectionId && docContextEnabled !== false) {
        void window.api.injectDocContext?.(
          connectionId,
          openCodeSessionId,
          answer,
          baseDirectory ?? undefined,
        );
      }

      window.api.sendPromptResponse({
        id: currentNode.prompt.id,
        answer,
        attachments: attachments?.length ? attachments : undefined,
      });
    },
    [],
  );

  const handleSelectOption = useCallback((option: string) => {
    // Same ref-first pattern as handleSubmit — read activeId from the ref
    // so injection always targets the correct subagent session.
    const currentId = activeIdRef.current;
    const currentNode = currentId
      ? (nodesRef.current.get(currentId) ?? null)
      : null;
    if (!currentNode?.prompt) return;

    // Use the same resilient clear as handleSubmit (fallback by connectionId).
    const nodeConnectionId = currentNode.connectionId;
    setNodes((prev) => {
      let key: string | null = prev.has(currentNode.id) ? currentNode.id : null;
      if (!key && nodeConnectionId) {
        for (const [k, n] of prev) {
          if (n.connectionId === nodeConnectionId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return prev;
      const node = prev.get(key)!;
      const next = new Map(prev);
      next.set(key, {
        ...node,
        channelMessages: [
          ...node.channelMessages,
          {
            id: `local-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: 'answer' as const,
            text: option,
            timestamp: new Date(),
          },
        ],
        prompt: null,
        hasPendingPrompt: false,
      });
      return next;
    });

    if (!nodesRef.current.has(currentNode.id) && nodeConnectionId) {
      for (const [k, n] of nodesRef.current) {
        if (n.connectionId === nodeConnectionId) {
          setActiveId(k);
          break;
        }
      }
    }

    // Inject relevant doc context into the provider session before the
    // prompt response. Uses the node's in-memory openCodeSessionId.
    const {
      openCodeSessionId,
      connectionId,
      docContextEnabled,
      baseDirectory,
    } = currentNode;
    if (openCodeSessionId && connectionId && docContextEnabled !== false) {
      void window.api.injectDocContext?.(
        connectionId,
        openCodeSessionId,
        option,
        baseDirectory ?? undefined,
      );
    }

    window.api.sendPromptResponse({
      id: currentNode.prompt.id,
      answer: option,
    });
  }, []);

  const handleDismissSession = useCallback((connectionId: string) => {
    void window.api.dismissSession?.(connectionId);
  }, []);

  const handleQueueSessionMessage = useCallback(
    (sessionId: string, message: string, attachments?: Attachment[]) => {
      const outboundId = `local-outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Always queue in SQLite for VS Code extension polling
      window.api.queueSessionMessage(sessionId, message);

      // Find the node that owns this sessionId (connectionId)
      setNodes((prev) => {
        let key: string | null = null;
        for (const [id, node] of prev) {
          if (node.connectionId === sessionId || node.id === sessionId) {
            key = id;
            break;
          }
        }
        if (!key) return prev;
        const node = prev.get(key)!;
        const next = new Map(prev);
        next.set(key, {
          ...node,
          channelMessages: [
            ...node.channelMessages,
            {
              id: outboundId,
              kind: 'outbound' as const,
              text: message,
              timestamp: new Date(),
              attachments,
            },
          ],
        });
        return next;
      });

      void inject(sessionId, outboundId, message, attachments);
    },
    [inject],
  );

  const handleClearChannelMessages = useCallback((sessionId: string) => {
    void window.api.clearSessionChannelMessages(sessionId);
  }, []);

  const handleToggleDocContext = useCallback(
    (nodeId: string) => {
      withNode(nodeId, (node) => ({
        ...node,
        docContextEnabled: node.docContextEnabled === false ? true : false,
      }));
    },
    [withNode],
  );

  const handleRemoveSession = useCallback(
    (sessionId: string): Promise<boolean> => {
      const targetSessionId = getRemoveSessionTarget(
        nodesRef.current.get(sessionId),
        sessionId,
      );
      return window.api.removeSessionChannel(targetSessionId);
    },
    [],
  );

  const handleReplyPermission = useCallback(
    (
      sessionID: string,
      requestId: string,
      reply: 'once' | 'always' | 'reject',
    ) => {
      // Optimistically remove from state immediately so the UI clears at once
      setNodes((prev) => {
        let nodeId: string | null = null;
        for (const [id, node] of prev) {
          if (node.pendingPermissions?.some((p) => p.requestId === requestId)) {
            nodeId = id;
            break;
          }
        }
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingPermissions: node.pendingPermissions.filter(
            (p) => p.requestId !== requestId,
          ),
        });
        return next;
      });
      void window.api.replyPermission(sessionID, requestId, reply);
    },
    [setNodes],
  );

  /** Jump focus to the first channel that has a pending prompt, if any. */
  const jumpToFirstPendingPrompt = useCallback(() => {
    for (const [id, node] of nodesRef.current) {
      if (node.hasPendingPrompt) {
        setActiveId(id);
        return;
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // New names
    nodes,
    activeId,
    setActiveId,
    activeNode,
    // Legacy aliases (used by App.tsx + PromptView — unchanged)
    connections,
    activeConnectionId,
    setActiveConnectionId,
    activeConn,
    clientInfo,
    handleSubmit,
    handleSelectOption,
    handleDismissStatus,
    handleDismissSession,
    handleQueueSessionMessage,
    handleClearChannelMessages,
    handleRemoveSession,
    handleToggleDocContext,
    handleReplyPermission,
    jumpToFirstPendingPrompt,
  };
}
