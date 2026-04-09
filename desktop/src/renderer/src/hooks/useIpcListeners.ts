import { useEffect, useRef } from 'react';
import type { ChannelMessage, SessionNode, PendingPermission } from '../types';
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
    pendingPermissions: [],
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
  clearAllNodes: () => void;
  loadChannelHistory: (connectionId: string) => Promise<void>;
  /** Apply any startup-buffered history for a connectionId once its node arrives. */
  applyStartupHistoryBuffer: (connectionId: string) => void;
};

// ---------------------------------------------------------------------------
// Internal helper — look up map key for a connectionId
// ---------------------------------------------------------------------------

export function findKeyByConnectionId(
  nodes: Map<string, SessionNode>,
  connectionId: string,
  openCodeSessionId?: string | null,
): string | null {
  for (const [id, node] of nodes) {
    if (node.connectionId === connectionId) return id;
  }
  // Fallback: after app restart the node's connectionId may still be
  // "auto-{sessionId}" or a stale UUID from the previous MCP session.
  // The openCodeSessionId (resolved from the DB by the main process)
  // matches the map key for OpenCode-backed nodes, so a direct lookup
  // resolves the correct node without a full scan.
  if (openCodeSessionId && nodes.has(openCodeSessionId)) {
    return openCodeSessionId;
  }
  return null;
}

/**
 * Find the map key that should *display* a prompt for the given connectionId.
 *
 * Prompts appear in the originating agent's own channel.
 */
export function findPromptTargetKey(
  nodes: Map<string, SessionNode>,
  connectionId: string,
  openCodeSessionId?: string | null,
): string | null {
  return findKeyByConnectionId(nodes, connectionId, openCodeSessionId);
}

// ---------------------------------------------------------------------------
// Helper — collect all descendant map keys for a given OpenCode session ID
// ---------------------------------------------------------------------------

/**
 * Returns the set of map keys for all nodes whose openCodeParentId chain
 * leads back to `rootOcId`. Used to cascade-delete a full subtree from
 * the renderer nodes map when a parent session is removed.
 */
export function collectDescendantKeys(
  nodes: Map<string, SessionNode>,
  rootOcId: string,
): Set<string> {
  const result = new Set<string>();
  // BFS over nodes looking for children
  const queue = [rootOcId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const [key, node] of nodes) {
      if (node.openCodeParentId === parentId) {
        result.add(key);
        // Walk into grandchildren using the child's own openCodeSessionId
        if (node.openCodeSessionId) {
          queue.push(node.openCodeSessionId);
        }
      }
    }
  }
  return result;
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
  clearAllNodes,
  loadChannelHistory,
  applyStartupHistoryBuffer,
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
        // Also drain any startup-buffered history for nodes that just appeared.
        for (const snap of snapshotNodes) {
          if (snap.connectionId) {
            // Drain startup buffer first (no-op if nothing buffered)
            applyStartupHistoryBuffer(snap.connectionId);
            if (!loadedHistoryIds.current.has(snap.connectionId)) {
              loadedHistoryIds.current.add(snap.connectionId);
              void loadChannelHistory(snap.connectionId);
            }
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
        // Route the prompt to the originating agent's own channel.
        const nodeId = findPromptTargetKey(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
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

        // Only switch the active channel to this prompt's node if the
        // currently active channel does NOT already have a pending prompt.
        // This prevents a new prompt from agent B from hijacking focus
        // while the user is in the middle of answering agent A's prompt.
        const currentActiveNode = activeConnectionRef.current
          ? prev.get(activeConnectionRef.current)
          : null;
        const activeChannelHasPrompt = Boolean(currentActiveNode?.prompt);
        if (!activeChannelHasPrompt) {
          setActiveId(nodeId);
          activateRef.current();
        }

        return next;
      });
    });

    // Clear the prompt UI when a prompt times out (main process sends this).
    window.api.onPromptClear?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        // Only clear if it's still the same prompt (guard against races).
        if (node.prompt?.id !== data.id) return prev;
        const next = new Map(prev);
        next.set(nodeId, { ...node, prompt: null, hasPendingPrompt: false });
        return next;
      });
    });

    window.api.onIntensiveChatStart?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
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
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
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
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
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
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
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
    // Permission events — push/remove pending permission requests
    // ------------------------------------------------------------------
    window.api.onPermissionAsked?.((data) => {
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.openCodeSessionId,
        );
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        const permission: PendingPermission = {
          requestId: data.requestId,
          sessionID: data.sessionID,
          permission: data.permission,
          patterns: data.patterns,
          always: data.always,
          tool: data.tool,
          metadata: data.metadata,
        };
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          pendingPermissions: [...node.pendingPermissions, permission],
        });
        return next;
      });
    });

    window.api.onPermissionReplied?.((data) => {
      setNodes((prev) => {
        // Find the node that owns the session
        let nodeId: string | null = null;
        for (const [id, node] of prev) {
          if (
            node.pendingPermissions.some((p) => p.requestId === data.requestID)
          ) {
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
            (p) => p.requestId !== data.requestID,
          ),
        });
        return next;
      });
    });

    // ------------------------------------------------------------------
    // Session channel events
    // ------------------------------------------------------------------
    window.api.onSessionChannelDeleted?.((data) => {
      // Track the resolved map key so setActiveId can clear it correctly.
      let deletedKey: string | null = null;
      let deletedOcId: string | null = null;

      setNodes((prev) => {
        // Resolve the primary key to delete
        const key: string | null = prev.has(data.sessionId)
          ? data.sessionId
          : findKeyByConnectionId(prev, data.sessionId);
        if (!key) return prev;

        deletedKey = key;
        const deletedNode = prev.get(key);
        // Prefer the node's openCodeSessionId for child lookup; fall back to
        // the map key (which IS the openCodeSessionId for OC-backed nodes).
        deletedOcId = deletedNode?.openCodeSessionId ?? key;

        // Collect descendants so the entire subtree is removed at once.
        const descendantKeys = collectDescendantKeys(prev, deletedOcId);

        const next = new Map(prev);
        next.delete(key);
        for (const dk of descendantKeys) {
          next.delete(dk);
        }
        return next;
      });

      setActiveId((prev) =>
        deletedKey !== null && prev === deletedKey ? null : prev,
      );
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

    window.api.onDatabaseReset?.(() => {
      clearAllNodes();
      setActiveId(null);
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
    clearAllNodes,
  ]);
}
