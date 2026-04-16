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
  projects: Project[];
};

let projectCache: ProjectCacheEntry | null = null;

function getProjects(
  nodes: Map<string, SessionNode>,
  pinnedPaths: string[],
): Project[] {
  const pinnedKey = pinnedPaths.join('\u0000');
  if (
    projectCache &&
    projectCache.nodes === nodes &&
    projectCache.pinnedKey === pinnedKey
  ) {
    return projectCache.projects;
  }

  const projects = groupByProject(nodes, pinnedPaths);
  projectCache = { nodes, pinnedKey, projects };
  return projects;
}

export function useSessionGraphProjects(pinnedPaths: string[]): Project[] {
  return useSessionGraphSelector((state) =>
    getProjects(state.nodes, pinnedPaths),
  );
}
