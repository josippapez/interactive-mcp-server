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
 * main-process session-tree-service.
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
  // Kept as a no-op wrapper around mergeSnapshotNode for any external
  // callers that may still import this helper. In the pull-on-invalidation
  // model the renderer refetches the full tree on `session-tree-invalidated`,
  // so optimistic node insertion is no longer needed internally.
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
  const snapshotSessionIds = new Set(
    snapshotNodes.map((snap) => snap.providerSessionId),
  );

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
      continue;
    }

    // OpenCode tree snapshots are authoritative. Nodes missing from the
    // limited snapshot must drop out so per-project pagination actually limits
    // the sidebar instead of keeping stale sessions from earlier full loads.
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

type SubtreeStats = {
  isRunning: boolean;
  hasUnread: boolean;
  latestActivity: number;
};

function buildChildrenByParent(
  nodes: SessionNode[],
): Map<string | null, SessionNode[]> {
  const childrenByParent = new Map<string | null, SessionNode[]>();
  for (const node of nodes) {
    if (node.isDirectConnection) continue;
    const parentId = node.openCodeParentId;
    const existing = childrenByParent.get(parentId);
    if (existing) {
      existing.push(node);
    } else {
      childrenByParent.set(parentId, [node]);
    }
  }
  return childrenByParent;
}

function buildSubtreeStats(
  nodes: SessionNode[],
  childrenByParent: Map<string | null, SessionNode[]>,
): Map<string, SubtreeStats> {
  const statsById = new Map<string, SubtreeStats>();
  const visit = (node: SessionNode): SubtreeStats => {
    const cached = statsById.get(node.providerSessionId ?? '');
    if (cached) return cached;

    let stats: SubtreeStats = {
      isRunning:
        node.hasPendingPrompt ||
        node.sessionStatuses.some((status) => status.type === 'working'),
      hasUnread: node.unreadCount > 0,
      latestActivity: getLatestActivityTime(node),
    };

    for (const child of childrenByParent.get(node.providerSessionId) ?? []) {
      const childStats = visit(child);
      stats = {
        isRunning: stats.isRunning || childStats.isRunning,
        hasUnread: stats.hasUnread || childStats.hasUnread,
        latestActivity: Math.max(
          stats.latestActivity,
          childStats.latestActivity,
        ),
      };
    }

    statsById.set(node.providerSessionId ?? '', stats);
    return stats;
  };

  for (const node of nodes) visit(node);
  return statsById;
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
  const childrenByParent = buildChildrenByParent(ocNodes);
  const subtreeStats = buildSubtreeStats(ocNodes, childrenByParent);
  const roots = childrenByParent.get(null) ?? [];

  // Sort roots by: running subtrees first, then by most recent subtree activity
  const sortedRoots = [...roots].sort((a, b) => {
    const aStats = subtreeStats.get(a.providerSessionId ?? '');
    const bStats = subtreeStats.get(b.providerSessionId ?? '');
    const aRunning = aStats?.isRunning ?? false;
    const bRunning = bStats?.isRunning ?? false;

    if (aRunning && !bRunning) return -1;
    if (!aRunning && bRunning) return 1;

    // Secondary: unread in subtree
    const aUnread = aStats?.hasUnread ?? false;
    const bUnread = bStats?.hasUnread ?? false;

    if (aUnread && !bUnread) return -1;
    if (!aUnread && bUnread) return 1;

    // Tertiary: most recent activity in subtree
    const aLatest = aStats?.latestActivity ?? 0;
    const bLatest = bStats?.latestActivity ?? 0;

    return bLatest - aLatest; // Descending (newest first)
  });

  const openCodeTree: SessionNode[] = [];
  for (const root of sortedRoots) {
    openCodeTree.push({ ...root, depth: 0 });
    openCodeTree.push(
      ...collectSubtree(childrenByParent, root.providerSessionId, 1),
    );
  }

  return { openCodeTree, directConnections };
}

/**
 * Recursively collect children of a given parent, depth-first.
 */
function collectSubtree(
  childrenByParent: Map<string | null, SessionNode[]>,
  parentId: string | null,
  depth: number,
): SessionNode[] {
  const children = [...(childrenByParent.get(parentId) ?? [])].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  const result: SessionNode[] = [];
  for (const child of children) {
    result.push({ ...child, depth });
    result.push(
      ...collectSubtree(childrenByParent, child.providerSessionId, depth + 1),
    );
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
  /** Newest session creation timestamp across all root sessions */
  latestSessionCreatedAt: number;
  /** Whether this project was manually pinned (vs auto-detected from sessions) */
  isPinned: boolean;
  /** Whether more root sessions are available for this project. */
  hasMoreSessions?: boolean;
};

/**
 * Extract the project path from a session node.
 * Prefers baseDirectory, falls back to directory, then "Unknown".
 */
function getProjectPath(node: SessionNode): string {
  return node.baseDirectory?.trim() || node.directory?.trim() || 'Unknown';
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
  projectPages: Map<string, { hasMore: boolean }> = new Map(),
): Project[] {
  const all = Array.from(nodes.values());
  const ocNodes = all.filter((n) => !n.isDirectConnection);
  const childrenByParent = buildChildrenByParent(ocNodes);
  const subtreeStats = buildSubtreeStats(ocNodes, childrenByParent);
  const roots = childrenByParent.get(null) ?? [];

  // Group root sessions by their project path
  const projectMap = new Map<string, SessionNode[]>();

  for (const root of roots) {
    const projectPath = getProjectPath(root);
    if (!projectMap.has(projectPath)) {
      projectMap.set(projectPath, []);
    }
    projectMap.get(projectPath)!.push(root);
  }

  // Add pinned paths that don't have any sessions yet.
  // Skip empty/whitespace-only paths defensively — they would otherwise
  // render a phantom rail tile with blank initials and a literal "Project"
  // tooltip (because getProjectName('') === '' and ProjectRail's display
  // fallback uses the literal string "Project").
  const sanitizedPinned = pinnedPaths.filter((path) => path?.trim());
  const pinnedSet = new Set(sanitizedPinned);
  for (const pinnedPath of sanitizedPinned) {
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
        latestSessionCreatedAt: 0,
        isPinned,
        hasMoreSessions: projectPages.get(path)?.hasMore ?? false,
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
      sessions.push(
        ...collectSubtree(childrenByParent, root.providerSessionId, 1),
      );
    }

    // Calculate project-level stats
    const isRunning = sortedRoots.some(
      (root) =>
        subtreeStats.get(root.providerSessionId ?? '')?.isRunning ?? false,
    );
    const hasUnread = sortedRoots.some(
      (root) =>
        subtreeStats.get(root.providerSessionId ?? '')?.hasUnread ?? false,
    );
    const latestActivity = Math.max(
      ...sortedRoots.map(
        (root) =>
          subtreeStats.get(root.providerSessionId ?? '')?.latestActivity ?? 0,
      ),
      0,
    );
    const earliestSessionCreatedAt = sortedRoots.reduce((earliest, session) => {
      const createdAt = session.createdAt ?? Number.POSITIVE_INFINITY;
      return Math.min(earliest, createdAt);
    }, Number.POSITIVE_INFINITY);
    const latestSessionCreatedAt = sortedRoots.reduce((latest, session) => {
      const createdAt = session.createdAt ?? 0;
      return Math.max(latest, createdAt);
    }, 0);

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
      latestSessionCreatedAt,
      isPinned,
      hasMoreSessions: projectPages.get(path)?.hasMore ?? false,
    });
  }

  // Sort pinned projects first, then by latest session creation time (newer
  // first). This keeps ordering stable and avoids activity-based jumping.
  projects.sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }

    const aEmpty = a.sessions.length === 0;
    const bEmpty = b.sessions.length === 0;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;

    const createdDiff = b.latestSessionCreatedAt - a.latestSessionCreatedAt;
    if (createdDiff !== 0) return createdDiff;

    return a.name.localeCompare(b.name);
  });

  return projects;
}

export function toPinnedProjectOptions(
  projects: readonly Project[],
): Array<{ path: string; name: string }> {
  return projects.map((project) => ({
    path: project.path,
    name: project.name,
  }));
}
