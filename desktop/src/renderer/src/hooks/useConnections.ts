import { useState, useCallback, useEffect, useRef } from 'react';
import type { Attachment, SessionNode } from '../types';
import { useChannelHistory } from './useChannelHistory';
import { useIpcListeners } from './useIpcListeners';
import { useOpenCodeInjection } from './useOpenCodeInjection';
import { getRemoveSessionTarget } from './remove-session-target';

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

  useIpcListeners({
    activeConnectionRef: activeIdRef,
    activateRef,
    setNodes,
    setActiveId,
    setClientInfo,
    withNode,
    loadChannelHistory,
  });

  const { inject } = useOpenCodeInjection(nodes, withNode);

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

  const appendAnswerMessage = useCallback(
    (nodeId: string, text: string, attachments?: Attachment[]) => {
      withNode(nodeId, (node) => ({
        ...node,
        channelMessages: [
          ...node.channelMessages,
          {
            id: `local-answer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: 'answer' as const,
            text,
            timestamp: new Date(),
            attachments,
          },
        ],
        prompt: null,
        hasPendingPrompt: false,
      }));
    },
    [withNode],
  );

  const handleSubmit = useCallback(
    (answer: string, attachments?: Attachment[]) => {
      if (!activeNode?.prompt) return;
      const { prompt } = activeNode;
      appendAnswerMessage(activeNode.id, answer, attachments);
      window.api.sendPromptResponse({
        id: prompt.id,
        answer,
        attachments: attachments?.length ? attachments : undefined,
      });
    },
    [activeNode, appendAnswerMessage],
  );

  const handleSelectOption = useCallback(
    (option: string) => {
      if (!activeNode?.prompt) return;
      const { prompt } = activeNode;
      appendAnswerMessage(activeNode.id, option);
      window.api.sendPromptResponse({ id: prompt.id, answer: option });
    },
    [activeNode, appendAnswerMessage],
  );

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

  const handleRemoveSession = useCallback((sessionId: string) => {
    const targetSessionId = getRemoveSessionTarget(
      nodesRef.current.get(sessionId),
      sessionId,
    );
    void window.api.removeSessionChannel(targetSessionId);
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
  };
}
