/**
 * Pure functions for merging session-tree snapshots into the renderer's
 * SessionNode map and for partitioning nodes into SESSIONS vs DIRECT
 * CONNECTIONS.
 *
 * Extracted from useIpcListeners and ChannelSidebar so they can be
 * unit-tested without React, Electron, or IPC.
 */

import type { SessionNode } from '../types';

/**
 * Shape of a single node in the session-tree snapshot emitted by the
 * main-process session-tree-manager.
 */
export interface SnapshotNode {
  openCodeSessionId: string;
  openCodeParentId: string | null;
  title: string;
  directory: string;
  depth: number;
  connectionId: string | null;
  channelName: string | null;
  hasMcpChannel: boolean;
  baseDirectory: string | null;
  registeredParentSessionId: string | null;
}

/**
 * Merge a session-tree snapshot into the existing SessionNode map.
 *
 * Rules:
 * 1. Every snapshot node becomes a tree entry keyed by openCodeSessionId.
 * 2. If a snapshot node's connectionId matches an existing direct-connection
 *    node, that direct-connection's runtime state (messages, prompts, unread)
 *    is absorbed into the tree node and the direct-connection is removed.
 * 3. Direct-connection nodes whose connectionId is NOT claimed by any
 *    snapshot node are preserved.
 * 4. Topology fields always come from the snapshot; runtime state is
 *    preserved from existing nodes (or absorbed direct-connection nodes).
 */
export function mergeSessionTreeSnapshot(
  prev: Map<string, SessionNode>,
  snapshotNodes: SnapshotNode[],
): Map<string, SessionNode> {
  const next = new Map<string, SessionNode>();

  // Build a set of connectionIds claimed by the snapshot so we can detect
  // direct-connection nodes that should be absorbed.
  const snapshotConnectionIds = new Set<string>();
  for (const snap of snapshotNodes) {
    if (snap.connectionId) snapshotConnectionIds.add(snap.connectionId);
  }

  for (const snap of snapshotNodes) {
    const id = snap.openCodeSessionId;
    const existing = prev.get(id);

    // Check if a direct-connection node exists for this snapshot's
    // connectionId — if so, absorb its runtime state.
    let directNode: SessionNode | undefined;
    if (snap.connectionId) {
      for (const [prevId, prevNode] of prev) {
        if (
          prevNode.isDirectConnection &&
          (prevNode.connectionId === snap.connectionId ||
            prevId === snap.connectionId)
        ) {
          directNode = prevNode;
          break;
        }
      }
    }

    // Merge source: prefer existing tree node, fall back to absorbed
    // direct-connection node, then defaults.
    const mergeSource = existing ?? directNode;

    next.set(id, {
      id,
      openCodeSessionId: snap.openCodeSessionId,
      openCodeParentId: snap.openCodeParentId,
      title: snap.channelName ?? snap.title,
      directory: snap.directory,
      depth: snap.depth,
      connectionId: snap.connectionId,
      hasMcpChannel: snap.hasMcpChannel,
      isDirectConnection: false,
      baseDirectory: snap.baseDirectory,
      sessionChannel: snap.connectionId
        ? {
            sessionId: snap.connectionId,
            label: snap.channelName ?? snap.title,
          }
        : !snap.openCodeParentId
          ? {
              sessionId: snap.openCodeSessionId,
              label: snap.title,
            }
          : (mergeSource?.sessionChannel ?? null),
      // Runtime state: preserved from merge source or defaulted
      prompt: mergeSource?.prompt ?? null,
      activeSession: mergeSource?.activeSession ?? null,
      channelMessages: mergeSource?.channelMessages ?? [],
      unreadCount: mergeSource?.unreadCount ?? 0,
      hasPendingPrompt: mergeSource?.hasPendingPrompt ?? false,
      sessionStatuses: mergeSource?.sessionStatuses ?? [],
      pendingPermissions: mergeSource?.pendingPermissions ?? [],
    });
  }

  // Preserve direct-connection nodes that were NOT absorbed.
  for (const [id, node] of prev) {
    if (
      node.isDirectConnection &&
      !snapshotConnectionIds.has(node.connectionId ?? '') &&
      !snapshotConnectionIds.has(id)
    ) {
      next.set(id, node);
    }
  }

  return next;
}

/**
 * Partition SessionNode map into two ordered lists:
 * - `openCodeTree`: root OpenCode sessions with their subagents in
 *   depth-first order.
 * - `directConnections`: MCP agents with no associated OpenCode session.
 */
export function partitionNodes(nodes: Map<string, SessionNode>): {
  openCodeTree: SessionNode[];
  directConnections: SessionNode[];
} {
  const all = Array.from(nodes.values());
  const directConnections = all.filter((n) => n.isDirectConnection);

  const ocNodes = all.filter((n) => !n.isDirectConnection);
  const roots = ocNodes.filter((n) => n.openCodeParentId === null);

  const openCodeTree: SessionNode[] = [];
  for (const root of roots) {
    openCodeTree.push({ ...root, depth: 0 });
    openCodeTree.push(...collectSubtree(ocNodes, root.openCodeSessionId, 1));
  }

  return { openCodeTree, directConnections };
}

/**
 * Recursively collect children of a given parent, depth-first.
 */
function collectSubtree(
  nodes: SessionNode[],
  parentId: string | null,
  depth: number,
): SessionNode[] {
  const children = nodes
    .filter((n) => n.openCodeParentId === parentId && !n.isDirectConnection)
    .sort((a, b) => a.title.localeCompare(b.title));

  const result: SessionNode[] = [];
  for (const child of children) {
    result.push({ ...child, depth });
    result.push(...collectSubtree(nodes, child.openCodeSessionId, depth + 1));
  }
  return result;
}
