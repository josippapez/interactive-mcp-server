import { useState, useCallback } from 'react';
import { useSessionStatus } from '../../../hooks/useSessionStatus';
import { useSidebarResize } from './useSidebarResize';
import { useCollapsedState } from './useCollapsedState';
import { usePinnedProjects } from './usePinnedProjects';
import { useSessionFiltering } from './useSessionFiltering';
import {
  useSessionGraphProjects,
  useSessionGraphSelector,
} from '../../../store/session-graph';

type UseSidebarStateProps = {
  activeConnectionId: string | null;
};

/**
 * Main orchestrating hook that composes smaller focused hooks.
 */
export function useSidebarState({ activeConnectionId }: UseSidebarStateProps) {
  // Pinned projects management
  const { pinnedPaths, handleAddProject, handleRemoveProject } =
    usePinnedProjects();

  const openCodeTree = useSessionGraphSelector((state) => state.openCodeTree);
  const directConnections = useSessionGraphSelector(
    (state) => state.directConnections,
  );
  const projects = useSessionGraphProjects(pinnedPaths);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await window.api.refreshSessionTree();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  // Session status from OpenCode API
  const { getStatus } = useSessionStatus(true);

  // Resize functionality
  const { sidebarRef, sidebarWidth, isResizing, handleMouseDown } =
    useSidebarResize();

  // Collapsed state management
  const {
    collapsedProjects,
    collapsedSessions,
    handleToggleProject,
    handleToggleSession,
  } = useCollapsedState();

  // Filtering and sorting
  const {
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
  } = useSessionFiltering({
    openCodeTree,
    directConnections,
    projects,
    activeConnectionId,
    getStatus,
  });

  return {
    // Refs
    sidebarRef,
    // State
    filter,
    setFilter,
    showInactive,
    collapsedProjects,
    collapsedSessions,
    sidebarWidth,
    isResizing,
    isRefreshing,
    // Computed
    filteredProjects,
    filteredDirectConnections,
    providerCounts,
    providerTabs,
    runningCount,
    inactiveCount,
    // Status
    getStatus,
    // Handlers
    handleRefresh,
    handleToggleInactive,
    handleToggleProject,
    handleToggleSession,
    handleAddProject,
    handleRemoveProject,
    handleMouseDown,
  };
}
