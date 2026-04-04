import { useEffect, useRef } from 'react';
import type { ChannelMessage, SessionNode } from '../types';
import { mergeSessionTreeSnapshot } from './session-tree-merge';

type SessionStatusType = 'info' | 'working' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Helper — creates a SessionNode for a direct MCP connection (no OpenCode)
// ---------------------------------------------------------------------------

export function createDirectConnectionNode(
  connectionId: string,
  name: string,
  sessionChannel: { sessionId: string; label?: string } | null,
): SessionNode {
  return {
    id: connectionId,
    openCodeSessionId: null,
    openCodeParentId: null,
    title: name,
    directory: '',
    depth: 0,
    connectionId,
    hasMcpChannel: true,
    isDirectConnection: true,
    prompt: null,
    activeSession: null,
    channelMessages: [],
    unreadCount: 0,
    hasPendingPrompt: false,
    sessionChannel,
    sessionStatuses: [],
    baseDirectory: null,
  };
}

// ---------------------------------------------------------------------------
// Hook opts
// ---------------------------------------------------------------------------

type Opts = {
  activeConnectionRef: React.RefObject<string | null>;
  activateRef: React.RefObject<() => void>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  setClientInfo: React.Dispatch<
    React.SetStateAction<{ model?: string; mode?: string } | undefined>
  >;
  withNode: (id: string, updater: (node: SessionNode) => SessionNode) => void;
  loadChannelHistory: (connectionId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Internal helper — look up map key for a connectionId
// ---------------------------------------------------------------------------

function findKeyByConnectionId(
  nodes: Map<string, SessionNode>,
  connectionId: string,
): string | null {
  for (const [id, node] of nodes) {
    if (node.connectionId === connectionId) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Registers all IPC listeners on mount.
 *
 * Session topology (tree shape, names, depths) comes from `session-tree-updated`
 * snapshots emitted by the main-process session-tree-manager.
 *
 * All prompt / channel / status events carry a `connectionId` and update the
 * matching node in place.
 */
export function useIpcListeners({
  activeConnectionRef,
  activateRef,
  setNodes,
  setActiveId,
  setClientInfo,
  withNode,
  loadChannelHistory,
}: Opts): void {
  const listenersRegistered = useRef(false);
  // Track which connectionIds we've already loaded history for.
  const loadedHistoryIds = useRef(new Set<string>());

  useEffect(() => {
    if (listenersRegistered.current) return;
    listenersRegistered.current = true;

    // ------------------------------------------------------------------
    // Local helper: append a message to a node by its map key
    // ------------------------------------------------------------------
    const appendMessage = (
      nodeId: string,
      message: Omit<ChannelMessage, 'id'>,
    ): void => {
      withNode(nodeId, (node) => ({
        ...node,
        channelMessages: [
          ...node.channelMessages,
          {
            ...message,
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ],
        unreadCount:
          activeConnectionRef.current === nodeId
            ? node.unreadCount
            : node.unreadCount + 1,
      }));
    };

    // ------------------------------------------------------------------
    // session-tree-updated — full snapshot from main process.
    // Merges topology; preserves live runtime state.
    // ------------------------------------------------------------------
    window.api.onSessionTreeUpdated?.((snapshotNodes) => {
      setNodes((prev) => {
        const next = mergeSessionTreeSnapshot(prev, snapshotNodes);

        // Load history once per connectionId for any newly-connected nodes.
        for (const snap of snapshotNodes) {
          if (
            snap.connectionId &&
            !loadedHistoryIds.current.has(snap.connectionId)
          ) {
            loadedHistoryIds.current.add(snap.connectionId);
            void loadChannelHistory(snap.connectionId);
          }
        }

        return next;
      });
    });

    // ------------------------------------------------------------------
    // Direct-connection lifecycle (MCP agents with no OpenCode session)
    // ------------------------------------------------------------------
    window.api.onConnectionOpened?.((data) => {
      setNodes((prev) => {
        // If any node already tracks this connectionId, skip.
        for (const node of prev.values()) {
          if (node.connectionId === data.connectionId) return prev;
        }
        const id = data.connectionId;
        if (prev.has(id)) return prev;
        const next = new Map(prev);
        next.set(
          id,
          createDirectConnectionNode(
            id,
            data.name,
            data.sessionId
              ? { sessionId: data.sessionId, label: data.label }
              : null,
          ),
        );
        return next;
      });
      setActiveId((prev) => prev ?? data.connectionId);
      if (!loadedHistoryIds.current.has(data.connectionId)) {
        loadedHistoryIds.current.add(data.connectionId);
        void loadChannelHistory(data.connectionId);
      }
      activateRef.current();
    });

    window.api.onConnectionClosed?.((data) => {
      setNodes((prev) => {
        const node = prev.get(data.connectionId);
        if (!node?.isDirectConnection) return prev;
        const next = new Map(prev);
        next.delete(data.connectionId);
        return next;
      });
      setActiveId((prev) => (prev === data.connectionId ? null : prev));
    });

    // ------------------------------------------------------------------
    // Prompt events — keyed by connectionId
    // ------------------------------------------------------------------
    window.api.onPromptRequest((data) => {
      if (data.clientInfo) setClientInfo(data.clientInfo);

      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(prev, data.connectionId);
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          prompt: data,
          hasPendingPrompt: true,
          baseDirectory: data.baseDirectory ?? node.baseDirectory,
          channelMessages: [
            ...node.channelMessages,
            {
              id: `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              kind: 'question' as const,
              text: data.message,
              timestamp: new Date(),
            },
          ],
          unreadCount:
            activeConnectionRef.current === nodeId
              ? node.unreadCount
              : node.unreadCount + 1,
        });
        setActiveId((prev2) => prev2 ?? nodeId);
        activateRef.current();
        return next;
      });
    });

    window.api.onIntensiveChatStart?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(prev, data.connectionId);
        if (!nodeId) return prev;
        const next = new Map(prev);
        next.set(nodeId, {
          ...prev.get(nodeId)!,
          activeSession: { id: data.sessionId, title: data.title },
        });
        setActiveId((prev2) => prev2 ?? nodeId);
        activateRef.current();
        return next;
      });
    });

    window.api.onIntensiveChatStop?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(prev, data.connectionId);
        if (!nodeId) return prev;
        const next = new Map(prev);
        next.set(nodeId, { ...prev.get(nodeId)!, activeSession: null });
        return next;
      });
    });

    // ------------------------------------------------------------------
    // Status updates and agent messages — keyed by connectionId
    // ------------------------------------------------------------------
    window.api.onSessionStatusUpdate?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(prev, data.connectionId);
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          sessionStatuses: [
            ...node.sessionStatuses,
            {
              status: data.status,
              type: data.type as SessionStatusType,
              timestamp: new Date(),
            },
          ],
        });
        return next;
      });
    });

    window.api.onAgentMessage?.((data) => {
      // Use setNodes to find the map key, then use appendMessage for the actual update.
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(prev, data.connectionId);
        if (nodeId) {
          // Schedule the message append outside this updater.
          setTimeout(() => {
            appendMessage(nodeId, {
              kind: 'agent_message',
              text: data.message,
              timestamp: new Date(),
            });
          }, 0);
        }
        return prev;
      });
    });

    // ------------------------------------------------------------------
    // Session channel events
    // ------------------------------------------------------------------
    window.api.onSessionChannelDeleted?.((data) => {
      setNodes((prev) => {
        // Always delete the node — this event only fires on explicit deletion
        // (user-initiated remove), not on normal disconnect.
        if (prev.has(data.sessionId)) {
          const next = new Map(prev);
          next.delete(data.sessionId);
          return next;
        }
        // Also handle OpenCode-keyed nodes (connectionId stored inside the node)
        const nodeId = findKeyByConnectionId(prev, data.sessionId);
        if (!nodeId) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      setActiveId((prev) => (prev === data.sessionId ? null : prev));
    });

    window.api.onSessionChannelMessagesCleared?.((data) => {
      setNodes((prev) => {
        // Check direct connection first
        const direct = prev.get(data.sessionId);
        if (direct) {
          const next = new Map(prev);
          next.set(data.sessionId, {
            ...direct,
            channelMessages: [],
            unreadCount: 0,
          });
          return next;
        }
        // OpenCode session keyed by openCodeSessionId
        const nodeId = findKeyByConnectionId(prev, data.sessionId);
        if (!nodeId) return prev;
        const next = new Map(prev);
        next.set(nodeId, {
          ...prev.get(nodeId)!,
          channelMessages: [],
          unreadCount: 0,
        });
        return next;
      });
    });

    // No cleanup needed — app-lifetime registrations.
    // listenersRegistered guard prevents double-registration in StrictMode.
  }, [
    activeConnectionRef,
    activateRef,
    loadChannelHistory,
    setActiveId,
    setClientInfo,
    setNodes,
    withNode,
  ]);
}
