import { useState, useCallback, useMemo } from 'react';
import type { SessionNode } from '../../../types';
import type { Project } from '../../../hooks/session-tree-merge';
import type { SessionStatusType } from '../../../hooks/useSessionStatus';
import { ProviderFilter } from './types';

type UseSessionFilteringProps = {
  openCodeTree: SessionNode[];
  directConnections: SessionNode[];
  projects: Project[];
  activeConnectionId: string | null;
  getStatus: (sessionId: string) => SessionStatusType | null;
};

/**
 * Hook for filtering, sorting, and computing session statistics.
 */
export function useSessionFiltering({
  openCodeTree,
  directConnections,
  projects,
  activeConnectionId,
  getStatus,
}: UseSessionFilteringProps) {
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [showInactive, setShowInactive] = useState(() => {
    const saved = localStorage.getItem('sidebar-show-inactive');
    return saved === 'true';
  });

  // Helper to check if a node is "running" (active)
  const isNodeRunning = useCallback(
    (node: SessionNode): boolean => {
      const status = getStatus(node.providerSessionId ?? '');
      return (
        node.hasPendingPrompt ||
        status === 'busy' ||
        node.sessionStatuses.some((s) => s.type === 'working')
      );
    },
    [getStatus],
  );

  // Filter nodes by provider
  const filterByProvider = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      if (filter === 'all') return nodes;
      return nodes.filter((node) => node.providerType === filter);
    },
    [filter],
  );

  // Filter nodes by activity status (running vs inactive)
  const filterByActivity = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      if (showInactive) return nodes;

      const visibleIds = new Set<string>();

      for (const node of nodes) {
        if (
          node.id === activeConnectionId ||
          isNodeRunning(node) ||
          node.unreadCount > 0
        ) {
          visibleIds.add(node.id);

          let parentId = node.openCodeParentId;
          while (parentId) {
            visibleIds.add(parentId);
            const parent = nodes.find(
              (n) => n.providerSessionId === parentId || n.id === parentId,
            );
            parentId = parent?.openCodeParentId ?? null;
          }
        }
      }

      return nodes.filter(
        (node) =>
          visibleIds.has(node.id) || visibleIds.has(node.providerSessionId!),
      );
    },
    [showInactive, activeConnectionId, isNodeRunning],
  );

  // Sort nodes by running status and recency
  const sortNodes = useCallback(
    (nodes: SessionNode[]): SessionNode[] => {
      return [...nodes].sort((a, b) => {
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
    },
    [isNodeRunning],
  );

  const filteredDirectConnections = useMemo(
    () => sortNodes(filterByActivity(filterByProvider(directConnections))),
    [sortNodes, filterByActivity, filterByProvider, directConnections],
  );

  const filteredProjects = useMemo(() => {
    return projects
      .map((project) => ({
        ...project,
        sessions: filterByActivity(filterByProvider(project.sessions)),
      }))
      .filter((project) => project.sessions.length > 0 || project.isPinned);
  }, [projects, filterByActivity, filterByProvider]);

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
  const inactiveCount = allNodes.length - runningCount;

  // Provider tabs based on actual counts
  const providerTabs = useMemo(() => {
    const tabs: ProviderFilter[] = ['all'];
    if (providerCounts.opencode > 0) tabs.push('opencode');
    if (providerCounts['copilot-cli'] > 0) tabs.push('copilot-cli');
    if (providerCounts['claude-sdk'] > 0) tabs.push('claude-sdk');
    if (providerCounts.standalone > 0) tabs.push('standalone');
    return tabs;
  }, [providerCounts]);

  const handleToggleInactive = useCallback(() => {
    const newValue = !showInactive;
    setShowInactive(newValue);
    localStorage.setItem('sidebar-show-inactive', String(newValue));
  }, [showInactive]);

  return {
    filter,
    setFilter,
    showInactive,
    filteredProjects,
    filteredDirectConnections,
    providerCounts,
    providerTabs,
    runningCount,
    inactiveCount,
    handleToggleInactive,
  };
}
