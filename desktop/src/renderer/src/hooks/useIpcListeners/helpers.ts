import type { SessionNode, ProviderType } from '../../types';

// ---------------------------------------------------------------------------
// Helper — creates a SessionNode for a direct MCP connection (no OpenCode)
// ---------------------------------------------------------------------------

export function createDirectConnectionNode(
  connectionId: string,
  name: string,
  sessionChannel: { sessionId: string; label?: string } | null,
  providerType?: ProviderType | null,
): SessionNode {
  return {
    id: connectionId,
    providerSessionId: null,
    openCodeParentId: null,
    title: name,
    directory: '',
    depth: 0,
    connectionId,
    hasMcpChannel: true,
    isDirectConnection: true,
    providerType: providerType ?? null,
    prompt: null,
    activeSession: null,
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel,
    sessionStatuses: [],
    pendingPermissions: [],
    pendingQuestions: [],
    baseDirectory: null,
    vcsInfo: null,
  };
}

// ---------------------------------------------------------------------------
// Internal helper — look up map key for a connectionId
// ---------------------------------------------------------------------------

export function findKeyByConnectionId(
  nodes: Map<string, SessionNode>,
  connectionId: string | null | undefined,
  providerSessionId?: string | null,
): string | null {
  // PRIMARY: When providerSessionId is provided, match by that FIRST.
  // This is critical for OpenCode's shared MCP client where multiple sessions
  // share the same connectionId (transport UUID). The providerSessionId is the
  // unique identifier for each agent session.
  if (providerSessionId) {
    // Direct map key lookup
    if (nodes.has(providerSessionId)) {
      return providerSessionId;
    }

    // Search by node.providerSessionId field
    for (const [id, node] of nodes) {
      if (node.providerSessionId === providerSessionId) {
        return id;
      }
    }
  }

  if (!connectionId) {
    return null;
  }

  // FALLBACK 1: match by node.connectionId field, but ONLY for nodes that
  // are direct connections OR have no providerSessionId. OpenCode-backed
  // nodes (providerSessionId !== null && !isDirectConnection) MUST be matched
  // by providerSessionId — multiple OC sessions share the same MCP transport
  // UUID, so a connectionId-only match would be non-deterministic and would
  // route messages to the wrong channel (the cross-channel routing bug).
  for (const [id, node] of nodes) {
    if (
      node.connectionId === connectionId &&
      (node.isDirectConnection || node.providerSessionId === null)
    ) {
      return id;
    }
  }

  // FALLBACK 2: direct map key lookup by connectionId — only safe when the
  // matched node is itself a direct connection (its map key IS its connectionId).
  const direct = nodes.get(connectionId);
  if (
    direct &&
    (direct.isDirectConnection || direct.providerSessionId === null)
  ) {
    return connectionId;
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
  connectionId: string | null | undefined,
  providerSessionId?: string | null,
): string | null {
  return findKeyByConnectionId(nodes, connectionId, providerSessionId);
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
        // Walk into grandchildren using the child's own providerSessionId
        if (node.providerSessionId) {
          queue.push(node.providerSessionId);
        }
      }
    }
  }
  return result;
}
