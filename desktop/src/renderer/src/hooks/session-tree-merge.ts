/**
 * Pure functions for merging session-tree snapshots into the renderer's
 * SessionNode map and for partitioning nodes into SESSIONS vs DIRECT
 * CONNECTIONS.
 *
 * Extracted from useIpcListeners and ChannelSidebar so they can be
 * unit-tested without React, Electron, or IPC.
 */

import type { ProviderType, SessionNode, VcsInfo } from '../types';

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
  providerType: ProviderType | null;
  vcsInfo: VcsInfo | null;
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

    // Prompt state is live/ephemeral and must NOT be pulled from a direct-connection
    // node that is being absorbed for the first time IF an existing tree node is
    // already in the map.  When `existing` is present, its prompt reflects the
    // latest renderer state (possibly already cleared by handleSubmit).  Pulling
    // `directNode.prompt` on top of that would resurrect a prompt the user already
    // dismissed — the session-tree-updated race condition.
    //
    // Rule: prompt/hasPendingPrompt always come from `existing` when it exists;
    // only fall back to `directNode` (first-time absorption) or null otherwise.
    const promptSource = existing ?? directNode;

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
      providerType: snap.providerType ?? mergeSource?.providerType ?? null,
      vcsInfo: snap.vcsInfo ?? mergeSource?.vcsInfo ?? null,
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
      prompt: promptSource?.prompt ?? null,
      activeSession: mergeSource?.activeSession ?? null,
      channelMessages: mergeSource?.channelMessages ?? [],
      unreadCount: mergeSource?.unreadCount ?? 0,
      lastReadMessageId: mergeSource?.lastReadMessageId ?? null,
      hasPendingPrompt: promptSource?.hasPendingPrompt ?? false,
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
 * Get the most recent activity timestamp from a node (status or message).
 */
function getLatestActivityTime(node: SessionNode): number {
  return Math.max(
    node.sessionStatuses.at(-1)?.timestamp.getTime() ?? 0,
    node.channelMessages.at(-1)?.timestamp.getTime() ?? 0,
  );
}

/**
 * Get the most recent activity time across an entire subtree (node + all descendants).
 */
function getSubtreeLatestActivityTime(
  node: SessionNode,
  allNodes: SessionNode[],
): number {
  const nodeTime = getLatestActivityTime(node);

  // Find all children recursively
  const children = allNodes.filter(
    (n) => n.openCodeParentId === node.openCodeSessionId,
  );

  if (children.length === 0) return nodeTime;

  const childTimes = children.map((child) =>
    getSubtreeLatestActivityTime(child, allNodes),
  );

  return Math.max(nodeTime, ...childTimes);
}

/**
 * Check if a node or any of its descendants is "running" (has activity).
 */
function isSubtreeRunning(node: SessionNode, allNodes: SessionNode[]): boolean {
  const isNodeActive =
    node.hasPendingPrompt ||
    node.sessionStatuses.some((s) => s.type === 'working');

  if (isNodeActive) return true;

  // Check children recursively
  const children = allNodes.filter(
    (n) => n.openCodeParentId === node.openCodeSessionId,
  );

  return children.some((child) => isSubtreeRunning(child, allNodes));
}

/**
 * Check if a node or any of its descendants has unread messages.
 */
function hasSubtreeUnread(node: SessionNode, allNodes: SessionNode[]): boolean {
  if (node.unreadCount > 0) return true;

  const children = allNodes.filter(
    (n) => n.openCodeParentId === node.openCodeSessionId,
  );

  return children.some((child) => hasSubtreeUnread(child, allNodes));
}

/**
 * Partition SessionNode map into two ordered lists:
 * - `openCodeTree`: root OpenCode sessions with their subagents in
 *   depth-first order. Roots are sorted by most recent activity in their
 *   subtree (running first, then by timestamp). Children stay grouped
 *   under their parents.
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

  // Sort roots by: running subtrees first, then by most recent subtree activity
  const sortedRoots = [...roots].sort((a, b) => {
    const aRunning = isSubtreeRunning(a, ocNodes);
    const bRunning = isSubtreeRunning(b, ocNodes);

    if (aRunning && !bRunning) return -1;
    if (!aRunning && bRunning) return 1;

    // Secondary: unread in subtree
    const aUnread = hasSubtreeUnread(a, ocNodes);
    const bUnread = hasSubtreeUnread(b, ocNodes);

    if (aUnread && !bUnread) return -1;
    if (!aUnread && bUnread) return 1;

    // Tertiary: most recent activity in subtree
    const aLatest = getSubtreeLatestActivityTime(a, ocNodes);
    const bLatest = getSubtreeLatestActivityTime(b, ocNodes);

    return bLatest - aLatest; // Descending (newest first)
  });

  const openCodeTree: SessionNode[] = [];
  for (const root of sortedRoots) {
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
