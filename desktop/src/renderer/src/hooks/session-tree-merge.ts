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
  providerSessionId: string;
  openCodeParentId: string | null;
  title: string;
  directory: string;
  createdAt?: number;
  updatedAt?: number;
  depth: number;
  connectionId: string | null;
  channelName: string | null;
  hasMcpChannel: boolean;
  baseDirectory: string | null;
  registeredParentSessionId: string | null;
  providerType: ProviderType | null;
  vcsInfo: VcsInfo | null;
}

function createSessionChannel(
  snap: Pick<SnapshotNode, 'providerSessionId' | 'connectionId' | 'title'>,
  fallback: SessionNode | undefined,
): SessionNode['sessionChannel'] {
  if (snap.providerSessionId) {
    return {
      sessionId: snap.providerSessionId,
      label: snap.title,
    };
  }

  if (snap.connectionId) {
    return {
      sessionId: snap.connectionId,
      label: snap.title,
    };
  }

  return fallback?.sessionChannel ?? null;
}

function mergeSnapshotNode(
  prev: Map<string, SessionNode>,
  snap: SnapshotNode,
  claimedConnectionIds?: Set<string>,
): SessionNode {
  const existing = prev.get(snap.providerSessionId);

  let directNode: SessionNode | undefined;
  if (snap.connectionId && !claimedConnectionIds?.has(snap.connectionId)) {
    for (const [prevId, prevNode] of prev) {
      if (
        prevNode.isDirectConnection &&
        (prevNode.connectionId === snap.connectionId ||
          prevId === snap.connectionId)
      ) {
        directNode = prevNode;
        // Mark this connectionId as claimed so sibling snapshot nodes that
        // share the same MCP transport don't re-absorb its runtime state and
        // duplicate channelMessages / pendingPermissions / etc.
        claimedConnectionIds?.add(snap.connectionId);
        break;
      }
    }
  }

  const mergeSource = existing ?? directNode;
  const promptSource = existing ?? directNode;
  const resolvedLabel = snap.title;

  return {
    id: snap.providerSessionId,
    providerSessionId: snap.providerSessionId,
    openCodeParentId: snap.openCodeParentId,
    title: resolvedLabel,
    directory: snap.directory,
    createdAt: snap.createdAt ?? mergeSource?.createdAt,
    depth: snap.depth,
    connectionId: snap.connectionId,
    hasMcpChannel: snap.hasMcpChannel,
    isDirectConnection: false,
    baseDirectory: snap.baseDirectory,
    providerType: snap.providerType ?? mergeSource?.providerType ?? null,
    vcsInfo: snap.vcsInfo ?? mergeSource?.vcsInfo ?? null,
    sessionChannel: createSessionChannel(snap, mergeSource),
    prompt: promptSource?.prompt ?? null,
    activeSession: mergeSource?.activeSession ?? null,
    channelMessages: mergeSource?.channelMessages ?? [],
    unreadCount: mergeSource?.unreadCount ?? 0,
    lastReadMessageId: mergeSource?.lastReadMessageId ?? null,
    hasPendingPrompt: promptSource?.hasPendingPrompt ?? false,
    sessionStatuses: mergeSource?.sessionStatuses ?? [],
    pendingPermissions: mergeSource?.pendingPermissions ?? [],
    pendingQuestions: mergeSource?.pendingQuestions ?? [],
  };
}

export function upsertOptimisticSessionNode(
  prev: Map<string, SessionNode>,
  snapshotNode: SnapshotNode,
): Map<string, SessionNode> {
  const next = new Map(prev);
  next.set(
    snapshotNode.providerSessionId,
    mergeSnapshotNode(prev, snapshotNode),
  );
  return next;
}

/**
 * Merge a session-tree snapshot into the existing SessionNode map.
 *
 * Rules:
 * 1. Every snapshot node becomes a tree entry keyed by providerSessionId.
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

  // Track which direct-connection connectionIds have already been absorbed
  // during this merge pass. A single MCP transport can be shared by multiple
  // OC sessions (parent + child subagent), and only ONE of them may inherit
  // the direct-connection's runtime state — otherwise channelMessages bleed
  // across sibling channels and render in the wrong chat history view.
  const claimedConnectionIds = new Set<string>();

  for (const snap of snapshotNodes) {
    next.set(
      snap.providerSessionId,
      mergeSnapshotNode(prev, snap, claimedConnectionIds),
    );
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

function getSessionCreatedAt(node: SessionNode): number {
  return node.createdAt ?? 0;
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
    (n) => n.openCodeParentId === node.providerSessionId,
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
    (n) => n.openCodeParentId === node.providerSessionId,
  );

  return children.some((child) => isSubtreeRunning(child, allNodes));
}

/**
 * Check if a node or any of its descendants has unread messages.
 */
function hasSubtreeUnread(node: SessionNode, allNodes: SessionNode[]): boolean {
  if (node.unreadCount > 0) return true;

  const children = allNodes.filter(
    (n) => n.openCodeParentId === node.providerSessionId,
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
    openCodeTree.push(...collectSubtree(ocNodes, root.providerSessionId, 1));
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
    result.push(...collectSubtree(nodes, child.providerSessionId, depth + 1));
  }
  return result;
}

// ─── Project-based grouping ────────────────────────────────────────────────

/**
 * A project is identified by its baseDirectory or directory path.
 * Sessions are grouped under their project.
 */
export type Project = {
  /** The absolute path to the project directory */
  path: string;
  /** Display name (last segment of path, e.g., "my-project") */
  name: string;
  /** Root sessions in this project (no parent, or parent is in another project) */
  sessions: SessionNode[];
  /** Whether any session in this project is running */
  isRunning: boolean;
  /** Whether any session in this project has unread messages */
  hasUnread: boolean;
  /** Most recent activity timestamp across all sessions */
  latestActivity: number;
  /** Oldest session creation timestamp across all root sessions */
  earliestSessionCreatedAt: number;
  /** Whether this project was manually pinned (vs auto-detected from sessions) */
  isPinned: boolean;
};

/**
 * Extract the project path from a session node.
 * Prefers baseDirectory, falls back to directory, then "Unknown".
 */
function getProjectPath(node: SessionNode): string {
  return node.baseDirectory ?? node.directory ?? 'Unknown';
}

/**
 * Extract the display name from a project path.
 * Returns the last segment of the path (folder name).
 */
function getProjectName(projectPath: string): string {
  if (projectPath === 'Unknown') return 'Unknown';
  const segments = projectPath.split('/').filter(Boolean);
  return segments[segments.length - 1] || projectPath;
}

/**
 * Group sessions by project (baseDirectory).
 * Returns an array of Project objects sorted by activity.
 * @param nodes - The session nodes map
 * @param pinnedPaths - Optional array of pinned project paths to include even if no sessions exist
 */
export function groupByProject(
  nodes: Map<string, SessionNode>,
  pinnedPaths: string[] = [],
): Project[] {
  const all = Array.from(nodes.values());
  const ocNodes = all.filter((n) => !n.isDirectConnection);
  const roots = ocNodes.filter((n) => n.openCodeParentId === null);

  // Group root sessions by their project path
  const projectMap = new Map<string, SessionNode[]>();

  for (const root of roots) {
    const projectPath = getProjectPath(root);
    if (!projectMap.has(projectPath)) {
      projectMap.set(projectPath, []);
    }
    projectMap.get(projectPath)!.push(root);
  }

  // Add pinned paths that don't have any sessions yet
  const pinnedSet = new Set(pinnedPaths);
  for (const pinnedPath of pinnedPaths) {
    if (!projectMap.has(pinnedPath)) {
      projectMap.set(pinnedPath, []);
    }
  }

  // Build Project objects
  const projects: Project[] = [];

  for (const [path, rootSessions] of projectMap) {
    const isPinned = pinnedSet.has(path);

    if (rootSessions.length === 0) {
      // Pinned project with no sessions
      projects.push({
        path,
        name: getProjectName(path),
        sessions: [],
        isRunning: false,
        hasUnread: false,
        latestActivity: 0,
        earliestSessionCreatedAt: 0,
        isPinned,
      });
      continue;
    }

    // Sort root sessions within the project
    const sortedRoots = [...rootSessions].sort((a, b) => {
      const createdDiff = getSessionCreatedAt(b) - getSessionCreatedAt(a);
      if (createdDiff !== 0) return createdDiff;

      return a.title.localeCompare(b.title);
    });

    // Build the session tree for each root
    const sessions: SessionNode[] = [];
    for (const root of sortedRoots) {
      sessions.push({ ...root, depth: 0 });
      sessions.push(...collectSubtree(ocNodes, root.providerSessionId, 1));
    }

    // Calculate project-level stats
    const isRunning = sortedRoots.some((r) => isSubtreeRunning(r, ocNodes));
    const hasUnread = sortedRoots.some((r) => hasSubtreeUnread(r, ocNodes));
    const latestActivity = Math.max(
      ...sortedRoots.map((r) => getSubtreeLatestActivityTime(r, ocNodes)),
      0,
    );
    const earliestSessionCreatedAt = sortedRoots.reduce((earliest, session) => {
      const createdAt = session.createdAt ?? Number.POSITIVE_INFINITY;
      return Math.min(earliest, createdAt);
    }, Number.POSITIVE_INFINITY);

    projects.push({
      path,
      name: getProjectName(path),
      sessions,
      isRunning,
      hasUnread,
      latestActivity,
      earliestSessionCreatedAt:
        earliestSessionCreatedAt === Number.POSITIVE_INFINITY
          ? 0
          : earliestSessionCreatedAt,
      isPinned,
    });
  }

  // Sort projects by earliest session start time (newer first).
  // This keeps ordering stable and avoids activity-based jumping.
  // Pinned projects without sessions go to the bottom.
  projects.sort((a, b) => {
    // Empty pinned projects go last
    const aEmpty = a.sessions.length === 0;
    const bEmpty = b.sessions.length === 0;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;

    const createdDiff = b.earliestSessionCreatedAt - a.earliestSessionCreatedAt;
    if (createdDiff !== 0) return createdDiff;

    return a.name.localeCompare(b.name);
  });

  return projects;
}
