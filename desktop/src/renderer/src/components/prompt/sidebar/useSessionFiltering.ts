import { useState, useCallback, useMemo, useRef } from 'react';
import type { SessionNode } from '../../../types';
import type { Project } from '../../../hooks/session-tree-merge';
import type {
  SessionStatusMap,
  SessionStatusType,
} from '../../../hooks/useSessionStatus';
import { ProviderFilter } from './types';

type UseSessionFilteringProps = {
  openCodeTree: SessionNode[];
  directConnections: SessionNode[];
  projects: Project[];
  /**
   * Stable identity across renders. Value lookups go through
   * `statusMap` so filter memos depend on the derived map rather than
   * the callback, keeping the sidebar quiet during status churn that
   * doesn't affect any session we track.
   */
  getStatus: (sessionId: string) => SessionStatusType | null;
  /**
   * Identity changes only when the session-status set actually
   * changes (see `useSessionStatus` for the shallow-equal gating).
   * Used as the memo dep for filter/sort passes.
   */
  statusMap: SessionStatusMap;
};

/**
 * Hook for filtering, sorting, and computing session statistics.
 *
 * Perf notes (H5):
 *   - `sortNodes` returns the previous array when the sorted tuple is
 *     element-for-element equal, so downstream memos (`filteredProjects`
 *     / `filteredDirectConnections`) keep their identity across no-op
 *     status updates.
 */
export function useSessionFiltering({
  openCodeTree,
  directConnections,
  projects,
  getStatus,
  statusMap,
}: UseSessionFilteringProps) {
  const [filter, setFilter] = useState<ProviderFilter>('all');

  // Helper to check if a node is "running" (active).
  //
  // Depends on `statusMap` (not `getStatus`) so this callback — and
  // every memo that uses it as a dep — invalidates only when the
  // status set actually changes. `getStatus` is reference-stable.
  const isNodeRunning = useCallback(
    (node: SessionNode): boolean => {
      const status = getStatus(node.providerSessionId ?? '');
      if (status === 'idle' || status === 'error') return node.hasPendingPrompt;
      return (
        node.hasPendingPrompt ||
        status === 'busy' ||
        node.sessionStatuses.some((s) => s.type === 'working')
      );
    },
    [statusMap, getStatus],
  );

  // Filter nodes by provider
  const filterByProvider = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      if (filter === 'all') return nodes;
      return nodes.filter((node) => node.providerType === filter);
    },
    [filter],
  );

  // Sort nodes by running status and recency.
  //
  // Memoize per caller so that when the input array identity + sorted
  // tuple are unchanged, we return the previous result and downstream
  // memos (`filteredProjects` / `filteredDirectConnections`) keep
  // their refs.
  const sortCacheRef = useRef<WeakMap<SessionNode[], SessionNode[]>>(
    new WeakMap(),
  );
  const sortNodes = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      const cache = sortCacheRef.current;
      const cached = cache.get(nodes);
      const sorted = [...nodes].sort((a, b) => {
        const aIsRunning = isNodeRunning(a);
        const bIsRunning = isNodeRunning(b);

        if (aIsRunning && !bIsRunning) return -1;
        if (!aIsRunning && bIsRunning) return 1;

        const aLatest = Math.max(
          a.sessionStatuses.at(-1)?.timestamp.getTime() ?? 0,
          a.channelMessages.at(-1)?.timestamp.getTime() ?? 0,
        );
        const bLatest = Math.max(
          b.sessionStatuses.at(-1)?.timestamp.getTime() ?? 0,
          b.channelMessages.at(-1)?.timestamp.getTime() ?? 0,
        );

        return bLatest - aLatest;
      });

      if (cached && cached.length === sorted.length) {
        let same = true;
        for (let i = 0; i < cached.length; i += 1) {
          if (cached[i] !== sorted[i]) {
            same = false;
            break;
          }
        }
        if (same) return cached;
      }
      cache.set(nodes, sorted);
      return sorted;
    },
    [isNodeRunning],
  );

  const filteredDirectConnections = useMemo(
    () => sortNodes(filterByProvider(directConnections)),
    [sortNodes, filterByProvider, directConnections],
  );

  const filteredProjects = useMemo(() => {
    return projects.map((project) => ({
      ...project,
      sessions: filterByProvider(project.sessions),
    }));
  }, [projects, filterByProvider]);

  // Get all nodes for counting
  const allNodes = useMemo(
    () => [...openCodeTree, ...directConnections],
    [openCodeTree, directConnections],
  );

  // Provider counts
  const providerCounts = useMemo(
    (): Record<ProviderFilter, number> => ({
      all: allNodes.length,
      opencode: allNodes.filter((n) => n.providerType === 'opencode').length,
      'copilot-cli': allNodes.filter((n) => n.providerType === 'copilot-cli')
        .length,
      'claude-sdk': allNodes.filter((n) => n.providerType === 'claude-sdk')
        .length,
      standalone: allNodes.filter(
        (n) => n.providerType === 'standalone' || !n.providerType,
      ).length,
    }),
    [allNodes],
  );

  // Running/inactive counts
  const runningCount = useMemo(
    () => allNodes.filter(isNodeRunning).length,
    [allNodes, isNodeRunning],
  );

  // Provider tabs based on actual counts
  const providerTabs = useMemo(() => {
    const tabs: ProviderFilter[] = ['all'];
    if (providerCounts.opencode > 0) tabs.push('opencode');
    if (providerCounts['copilot-cli'] > 0) tabs.push('copilot-cli');
    if (providerCounts['claude-sdk'] > 0) tabs.push('claude-sdk');
    if (providerCounts.standalone > 0) tabs.push('standalone');
    return tabs;
  }, [providerCounts]);

  return {
    filter,
    setFilter,
    filteredProjects,
    filteredDirectConnections,
    providerCounts,
    providerTabs,
    runningCount,
  };
}
