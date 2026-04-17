/**
 * Central message dispatch system.
 *
 * This module provides a unified interface for sending messages to agents,
 * ensuring consistent routing across all message types (prompt responses,
 * queued messages, injections).
 *
 * KEY PRINCIPLE: After Phase 5 of the provider-session-id unification, the
 * renderer `nodes` map is keyed by `providerSessionId` for provider-backed
 * sessions and by `connectionId` for direct (non-provider) connections.
 * Resolution is therefore a single direct lookup — no multi-priority
 * fallback chains, no `findNodeKeyWithFallback` patch-up.
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
import { useCallback } from 'react';
import type { SessionNode } from '../types';
import { activeChannelIdAtom } from './channel-selection';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * The resolved target for a message dispatch operation.
 */
export interface DispatchTarget {
  /**
   * The session ID to use for routing. This is the node's
   * `providerSessionId` for provider-backed sessions, or its `connectionId`
   * for direct connections.
   */
  sessionId: string;

  /**
   * The MCP transport connection ID, if available. Transport handle only —
   * never used as an identity key on its own.
   */
  connectionId: string | null;

  /**
   * The provider session ID (e.g. OpenCode `ses_xxx`), if the node is
   * bound to a provider.
   */
  providerSessionId: string | null;

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
    | 'prompt-session' // Node looked up from prompt-bearing active channel
    | 'node-session' // Node with providerSessionId
    | 'node-connection'; // Direct connection node (no providerSessionId)
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
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Build a DispatchTarget from a node that was located in the nodes map.
 *
 * The node's identity (`providerSessionId` or `connectionId`) determines
 * the `sessionId` used for routing — no fallback chains, since the map is
 * keyed on this identity after Phase 5.
 */
function targetFromNode(
  nodeKey: string,
  node: SessionNode,
  resolvedVia: DispatchTarget['resolvedVia'],
): DispatchTarget {
  if (node.providerSessionId) {
    return {
      sessionId: node.providerSessionId,
      connectionId: node.connectionId,
      providerSessionId: node.providerSessionId,
      nodeKey,
      node,
      resolvedVia,
    };
  }

  // Direct connection: sessionId == connectionId == nodeKey
  const connectionId = node.connectionId ?? nodeKey;
  return {
    sessionId: connectionId,
    connectionId,
    providerSessionId: null,
    nodeKey,
    node,
    resolvedVia: 'node-connection',
  };
}

// -----------------------------------------------------------------------------
// Core resolution functions
// -----------------------------------------------------------------------------

/**
 * Resolve the dispatch target for a prompt response.
 *
 * The active channel's node is the authoritative target: it carries the
 * prompt and the provider-session identity. The prompt payload's own
 * `providerSessionId` is informational — the map lookup is by the active
 * channel key, which is already `providerSessionId`-keyed.
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

  return targetFromNode(activeChannelId, node, 'prompt-session');
}

/**
 * Resolve the dispatch target for a user-initiated message.
 *
 * Direct map lookup on the active channel's key. The map key IS the
 * node's identity (`providerSessionId` or, for direct connections,
 * `connectionId`), so no fallback is required.
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

  return targetFromNode(
    activeChannelId,
    node,
    node.providerSessionId ? 'node-session' : 'node-connection',
  );
}

/**
 * Resolve target for a specific session ID (used by handleQueueSessionMessage
 * and similar flows that reference a session by its identity string).
 *
 * Direct map lookup. `sessionId` is expected to be the node's map key —
 * either a `providerSessionId` or a direct-connection `connectionId`.
 */
export function resolveTargetBySessionId(
  nodes: Map<string, SessionNode>,
  sessionId: string,
): DispatchTarget | null {
  logDispatch('resolveTargetBySessionId', 'start', {
    sessionId,
    nodesCount: nodes.size,
  });

  const node = nodes.get(sessionId);
  if (!node) {
    logDispatch('resolveTargetBySessionId', 'not-found', { sessionId });
    return null;
  }

  const target = targetFromNode(
    sessionId,
    node,
    node.providerSessionId ? 'node-session' : 'node-connection',
  );
  logDispatch('resolveTargetBySessionId', 'direct-key-match', {
    sessionId,
    nodeKey: sessionId,
    resolvedSessionId: target.sessionId,
    nodeTitle: node.title,
  });
  return target;
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
