import { useRef, useSyncExternalStore } from 'react';
import { Store } from '@tanstack/store';
import {
  groupByProject,
  partitionNodes,
  type Project,
} from '../hooks/session-tree-merge';
import type { SessionNode } from '../types';
import {
  buildSessionActions,
  type QuickSwitcherAction,
} from '../components/QuickSwitcher.actions';

type SessionGraphState = {
  nodes: Map<string, SessionNode>;
  openCodeTree: SessionNode[];
  directConnections: SessionNode[];
  quickSwitcherActions: QuickSwitcherAction[];
  connectionCount: number;
  hasPendingPrompt: boolean;
  sessionTreeLimit: number;
  sessionTreeHasMore: boolean;
  sessionTreeProjectPages: Map<string, { limit: number; hasMore: boolean }>;
};

const EMPTY_NODES = new Map<string, SessionNode>();

function sameNodeList(a: SessionNode[], b: SessionNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function sameQuickSwitcherActions(
  a: QuickSwitcherAction[],
  b: QuickSwitcherAction[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.description !== right.description ||
      left.icon !== right.icon ||
      left.providerType !== right.providerType ||
      left.hasPendingPrompt !== right.hasPendingPrompt
    ) {
      return false;
    }
  }

  return true;
}

function createState(
  nodes: Map<string, SessionNode>,
  previous?: SessionGraphState,
  metadata?: {
    limit: number;
    hasMore: boolean;
    projectPages?: Array<{ path: string; limit: number; hasMore: boolean }>;
  },
): SessionGraphState {
  const { openCodeTree, directConnections } = partitionNodes(nodes);
  const quickSwitcherActions = buildSessionActions(nodes);
  const hasPendingPrompt = Array.from(nodes.values()).some(
    (node) => node.hasPendingPrompt || node.pendingQuestions.length > 0,
  );
  const nextOpenCodeTree =
    previous && sameNodeList(previous.openCodeTree, openCodeTree)
      ? previous.openCodeTree
      : openCodeTree;
  const nextDirectConnections =
    previous && sameNodeList(previous.directConnections, directConnections)
      ? previous.directConnections
      : directConnections;
  const nextQuickSwitcherActions =
    previous &&
    sameQuickSwitcherActions(
      previous.quickSwitcherActions,
      quickSwitcherActions,
    )
      ? previous.quickSwitcherActions
      : quickSwitcherActions;

  return {
    nodes,
    openCodeTree: nextOpenCodeTree,
    directConnections: nextDirectConnections,
    quickSwitcherActions: nextQuickSwitcherActions,
    connectionCount: nodes.size,
    hasPendingPrompt,
    sessionTreeLimit: metadata?.limit ?? previous?.sessionTreeLimit ?? 50,
    sessionTreeHasMore:
      metadata?.hasMore ?? previous?.sessionTreeHasMore ?? false,
    sessionTreeProjectPages: metadata?.projectPages
      ? new Map(
          metadata.projectPages.map((page) => [
            page.path,
            { limit: page.limit, hasMore: page.hasMore },
          ]),
        )
      : (previous?.sessionTreeProjectPages ?? new Map()),
  };
}

export const sessionGraphStore = new Store<SessionGraphState>(
  createState(EMPTY_NODES),
);

export function setSessionGraphNodes(nodes: Map<string, SessionNode>): void {
  sessionGraphStore.setState((prev) => {
    if (prev.nodes === nodes) return prev;
    return createState(nodes, prev);
  });
}

export function setSessionGraphTreeResult(input: {
  nodes: Map<string, SessionNode>;
  limit: number;
  hasMore: boolean;
  projectPages?: Array<{ path: string; limit: number; hasMore: boolean }>;
}): void {
  sessionGraphStore.setState((prev) =>
    createState(input.nodes, prev, {
      limit: input.limit,
      hasMore: input.hasMore,
      projectPages: input.projectPages,
    }),
  );
}

export function useSessionGraphSelector<T>(
  selector: (state: SessionGraphState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<T | undefined>(undefined);

  return useSyncExternalStore(
    (listener) => sessionGraphStore.subscribe(listener),
    () => {
      const next = selector(sessionGraphStore.state);
      const previous = cacheRef.current;
      if (previous !== undefined && isEqual(previous, next)) {
        return previous;
      }
      cacheRef.current = next;
      return next;
    },
    () => selector(sessionGraphStore.state),
  );
}

type ProjectCacheEntry = {
  nodes: Map<string, SessionNode>;
  pinnedKey: string;
  projectPages: Map<string, { limit: number; hasMore: boolean }>;
  projects: Project[];
};

let projectCache: ProjectCacheEntry | null = null;

function getProjects(
  nodes: Map<string, SessionNode>,
  pinnedPaths: string[],
  projectPages: Map<string, { limit: number; hasMore: boolean }>,
): Project[] {
  const pinnedKey = pinnedPaths.join('\u0000');
  if (
    projectCache &&
    projectCache.nodes === nodes &&
    projectCache.pinnedKey === pinnedKey &&
    projectCache.projectPages === projectPages
  ) {
    return projectCache.projects;
  }

  const projects = groupByProject(nodes, pinnedPaths, projectPages);
  projectCache = { nodes, pinnedKey, projectPages, projects };
  return projects;
}

export function useSessionGraphProjects(pinnedPaths: string[]): Project[] {
  return useSessionGraphSelector((state) =>
    getProjects(state.nodes, pinnedPaths, state.sessionTreeProjectPages),
  );
}
