/**
 * Central message dispatch system.
 *
 * This module provides a unified interface for sending messages to agents,
 * ensuring consistent routing across all message types (prompt responses,
 * queued messages, injections).
 *
 * KEY PRINCIPLE: The dispatch system automatically determines the correct
 * target session based on context, preventing routing bugs in parent-child
 * session scenarios.
 *
 * Usage:
 * ```ts
 * const dispatch = useMessageDispatch();
 *
 * // For prompt responses (uses prompt's session ID)
 * dispatch.respondToPrompt(answer, attachments);
 *
 * // For user-initiated messages (uses active channel's session ID)
 * dispatch.sendMessage(message, attachments);
 *
 * // For injections with reply expected
 * dispatch.injectWithReply(message, attachments, modelOverride);
 * ```
 */

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useRef } from 'react';
import type { Attachment, SessionNode } from '../types';
import { activeChannelIdAtom, selectChannelAtom } from './channel-selection';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * The resolved target for a message dispatch operation.
 */
export interface DispatchTarget {
  /**
   * The session ID to use for routing (openCodeSessionId or connectionId).
   */
  sessionId: string;

  /**
   * The MCP transport connection ID.
   */
  connectionId: string;

  /**
   * The OpenCode session ID, if available.
   */
  openCodeSessionId: string | null;

  /**
   * The node key in the nodes map.
   */
  nodeKey: string;

  /**
   * The full node data.
   */
  node: SessionNode;

  /**
   * How the target was resolved.
   */
  resolvedVia:
    | 'prompt-session' // From prompt.openCodeSessionId
    | 'node-session' // From node.openCodeSessionId
    | 'node-connection' // From node.connectionId
    | 'active-channel'; // From activeChannelId
}

/**
 * Model override for injection operations.
 */
export interface ModelOverride {
  providerId: string;
  modelId: string;
  variant?: string;
}

/**
 * Options for message dispatch operations.
 */
export interface DispatchOptions {
  /**
   * Whether to inject doc context before the message.
   * Default: true (respects node.docContextEnabled)
   */
  injectDocContext?: boolean;

  /**
   * Model override for injection operations.
   */
  modelOverride?: ModelOverride;
}

// -----------------------------------------------------------------------------
// Atoms for dispatch state
// -----------------------------------------------------------------------------

/**
 * Atom to store the nodes map reference for dispatch operations.
 * This is set by useConnections and read by the dispatch system.
 */
export const nodesMapAtom = atom<Map<string, SessionNode>>(new Map());

/**
 * Atom to track the last dispatch operation for debugging.
 */
export const lastDispatchAtom = atom<{
  type: string;
  target: DispatchTarget | null;
  timestamp: Date;
} | null>(null);

// -----------------------------------------------------------------------------
// Core resolution functions
// -----------------------------------------------------------------------------

/**
 * Resolve the dispatch target for a prompt response.
 *
 * CRITICAL: For prompt responses, always use the prompt's openCodeSessionId,
 * NOT the node's. The prompt carries the session ID of the agent that sent it.
 */
export function resolvePromptTarget(
  nodes: Map<string, SessionNode>,
  activeChannelId: string | null,
): DispatchTarget | null {
  if (!activeChannelId) {
    logDispatch('resolvePromptTarget', 'no-active-channel', {});
    return null;
  }

  const node = nodes.get(activeChannelId);
  if (!node?.prompt) {
    logDispatch('resolvePromptTarget', 'no-prompt', { activeChannelId });
    return null;
  }

  const { prompt } = node;

  // PRIORITY 1: Use prompt's openCodeSessionId (the agent that sent the prompt)
  if (prompt.openCodeSessionId) {
    return {
      sessionId: prompt.openCodeSessionId,
      connectionId: prompt.connectionId,
      openCodeSessionId: prompt.openCodeSessionId,
      nodeKey: activeChannelId,
      node,
      resolvedVia: 'prompt-session',
    };
  }

  // PRIORITY 2: Use node's openCodeSessionId
  if (node.openCodeSessionId) {
    return {
      sessionId: node.openCodeSessionId,
      connectionId: node.connectionId ?? prompt.connectionId,
      openCodeSessionId: node.openCodeSessionId,
      nodeKey: activeChannelId,
      node,
      resolvedVia: 'node-session',
    };
  }

  // PRIORITY 3: Use connectionId
  const connectionId = node.connectionId ?? prompt.connectionId;
  return {
    sessionId: connectionId,
    connectionId,
    openCodeSessionId: null,
    nodeKey: activeChannelId,
    node,
    resolvedVia: 'node-connection',
  };
}

/**
 * Resolve the dispatch target for a user-initiated message.
 *
 * Unlike prompt responses, user messages use the active channel's session ID.
 */
export function resolveMessageTarget(
  nodes: Map<string, SessionNode>,
  activeChannelId: string | null,
): DispatchTarget | null {
  if (!activeChannelId) {
    logDispatch('resolveMessageTarget', 'no-active-channel', {});
    return null;
  }

  const node = nodes.get(activeChannelId);
  if (!node) {
    logDispatch('resolveMessageTarget', 'node-not-found', { activeChannelId });
    return null;
  }

  // PRIORITY 1: Use openCodeSessionId for OpenCode sessions
  if (node.openCodeSessionId) {
    return {
      sessionId: node.openCodeSessionId,
      connectionId: node.connectionId ?? node.id,
      openCodeSessionId: node.openCodeSessionId,
      nodeKey: activeChannelId,
      node,
      resolvedVia: 'node-session',
    };
  }

  // PRIORITY 2: Use connectionId for direct connections
  if (node.connectionId) {
    return {
      sessionId: node.connectionId,
      connectionId: node.connectionId,
      openCodeSessionId: null,
      nodeKey: activeChannelId,
      node,
      resolvedVia: 'node-connection',
    };
  }

  // PRIORITY 3: Use node.id as fallback
  return {
    sessionId: node.id,
    connectionId: node.id,
    openCodeSessionId: null,
    nodeKey: activeChannelId,
    node,
    resolvedVia: 'active-channel',
  };
}

/**
 * Resolve target for a specific session ID (used by handleQueueSessionMessage).
 */
export function resolveTargetBySessionId(
  nodes: Map<string, SessionNode>,
  sessionId: string,
): DispatchTarget | null {
  logDispatch('resolveTargetBySessionId', 'start', {
    sessionId,
    nodesCount: nodes.size,
    nodeKeys: Array.from(nodes.keys()),
  });

  // PRIORITY 1: Direct map key lookup
  if (nodes.has(sessionId)) {
    const node = nodes.get(sessionId)!;
    const target = {
      sessionId: node.openCodeSessionId ?? node.connectionId ?? sessionId,
      connectionId: node.connectionId ?? sessionId,
      openCodeSessionId: node.openCodeSessionId,
      nodeKey: sessionId,
      node,
      resolvedVia: 'node-session' as const,
    };
    logDispatch('resolveTargetBySessionId', 'direct-key-match', {
      sessionId,
      nodeKey: sessionId,
      resolvedSessionId: target.sessionId,
      nodeTitle: node.title,
    });
    return target;
  }

  // PRIORITY 2: Search by openCodeSessionId
  for (const [key, node] of nodes) {
    if (node.openCodeSessionId === sessionId) {
      const target = {
        sessionId,
        connectionId: node.connectionId ?? key,
        openCodeSessionId: sessionId,
        nodeKey: key,
        node,
        resolvedVia: 'node-session' as const,
      };
      logDispatch('resolveTargetBySessionId', 'openCodeSessionId-match', {
        sessionId,
        nodeKey: key,
        nodeTitle: node.title,
      });
      return target;
    }
  }

  // PRIORITY 3: Search by connectionId
  for (const [key, node] of nodes) {
    if (node.connectionId === sessionId) {
      const target = {
        sessionId,
        connectionId: sessionId,
        openCodeSessionId: node.openCodeSessionId,
        nodeKey: key,
        node,
        resolvedVia: 'node-connection' as const,
      };
      logDispatch('resolveTargetBySessionId', 'connectionId-match', {
        sessionId,
        nodeKey: key,
        nodeTitle: node.title,
        openCodeSessionId: node.openCodeSessionId,
      });
      return target;
    }
  }

  logDispatch('resolveTargetBySessionId', 'not-found', { sessionId });
  return null;
}

/**
 * Resolve the target for interactive user messages in the desktop UI.
 *
 * User-entered messages always go to the currently selected channel.
 * This keeps submit/Ctrl+Enter behavior simple and predictable.
 */
export function resolveInteractiveMessageTarget(
  nodes: Map<string, SessionNode>,
  activeChannelId: string | null,
  requestedSessionId: string,
): DispatchTarget | null {
  // Interactive submit must follow the currently selected channel only.
  // If a channel is selected, do not fall back to another requested session.
  // This prevents cross-channel leakage when stale IDs are passed in callbacks.
  const activeTarget = resolveMessageTarget(nodes, activeChannelId);
  if (activeChannelId !== null) {
    return activeTarget;
  }

  // If no channel is selected, use explicit requested session as fallback.
  return resolveTargetBySessionId(nodes, requestedSessionId);
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

/**
 * Log message dispatch events to both console (dev only) and the main process
 * log file (always). This ensures routing diagnostics are persisted for debugging.
 */
function logDispatch(
  fn: string,
  resolution: string,
  details: Record<string, unknown>,
): void {
  const message = `${fn}: ${resolution} ${JSON.stringify(details)}`;

  // Log to file via IPC for persistent diagnostics (guard for test environment)
  if (typeof window !== 'undefined' && window.api?.log) {
    window.api.log('info', 'message-dispatch', message);
  }

  // Also log to console in development for immediate visibility
  if (process.env.NODE_ENV === 'development') {
    console.log(`[message-dispatch] ${fn}:`, resolution, details);
  }
}

// -----------------------------------------------------------------------------
// Hook: useDispatchTarget
// -----------------------------------------------------------------------------

/**
 * Hook to get the current dispatch target for the active channel.
 *
 * This hook provides real-time target resolution that updates when:
 * - The active channel changes
 * - The nodes map changes
 * - A prompt arrives or is cleared
 */
export function useDispatchTarget(): {
  /** Target for prompt responses (null if no active prompt) */
  promptTarget: DispatchTarget | null;
  /** Target for user-initiated messages (null if no active channel) */
  messageTarget: DispatchTarget | null;
  /** Resolve target for a specific session ID */
  resolveBySessionId: (sessionId: string) => DispatchTarget | null;
} {
  const nodes = useAtomValue(nodesMapAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);

  const resolveBySessionId = useCallback(
    (sessionId: string) => resolveTargetBySessionId(nodes, sessionId),
    [nodes],
  );

  return {
    promptTarget: resolvePromptTarget(nodes, activeChannelId),
    messageTarget: resolveMessageTarget(nodes, activeChannelId),
    resolveBySessionId,
  };
}

// -----------------------------------------------------------------------------
// Hook: useUpdateNodesMap
// -----------------------------------------------------------------------------

/**
 * Hook to update the nodes map atom from useConnections.
 * Call this whenever the nodes map changes.
 */
export function useUpdateNodesMap(): (nodes: Map<string, SessionNode>) => void {
  const setNodes = useSetAtom(nodesMapAtom);
  return setNodes;
}

// -----------------------------------------------------------------------------
// Utility: findNodeKeyWithFallback
// -----------------------------------------------------------------------------

/**
 * Find the node key with fallback for node key changes (e.g., direct→tree absorption).
 *
 * This handles the case where a node's map key changes from connectionId to
 * openCodeSessionId when it gets absorbed into an OpenCode session tree.
 */
export function findNodeKeyWithFallback(
  nodes: Map<string, SessionNode>,
  primaryKey: string,
  fallbackConnectionId: string | null,
): string | null {
  // Primary lookup
  if (nodes.has(primaryKey)) {
    return primaryKey;
  }

  // Fallback: search by connectionId
  if (fallbackConnectionId) {
    for (const [key, node] of nodes) {
      if (node.connectionId === fallbackConnectionId) {
        return key;
      }
    }
  }

  return null;
}
