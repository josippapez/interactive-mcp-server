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
    openCodeSessionId: null,
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
  connectionId: string,
  openCodeSessionId?: string | null,
): string | null {
  // PRIMARY: When openCodeSessionId is provided, match by that FIRST.
  // This is critical for OpenCode's shared MCP client where multiple sessions
  // share the same connectionId (transport UUID). The openCodeSessionId is the
  // unique identifier for each agent session.
  if (openCodeSessionId) {
    // Direct map key lookup
    if (nodes.has(openCodeSessionId)) {
      return openCodeSessionId;
    }

    // Search by node.openCodeSessionId field
    for (const [id, node] of nodes) {
      if (node.openCodeSessionId === openCodeSessionId) {
        return id;
      }
    }
  }

  // FALLBACK 1: match by node.connectionId field
  // Only used when openCodeSessionId is not provided or not found
  for (const [id, node] of nodes) {
    if (node.connectionId === connectionId) {
      return id;
    }
  }

  // FALLBACK 2: direct map key lookup by connectionId
  // For direct connections, the map key IS the connectionId.
  if (nodes.has(connectionId)) {
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
