import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSessionStatus } from '../../../hooks/useSessionStatus';
import { useSidebarResize } from './useSidebarResize';
import { useCollapsedState } from './useCollapsedState';
import { usePinnedProjects } from './usePinnedProjects';
import { useSessionFiltering } from './useSessionFiltering';
import {
  useSessionGraphProjects,
  useSessionGraphSelector,
} from '../../../store/session-graph';

/** Local storage key for persisted selected project */
const SELECTED_PROJECT_KEY = 'sidebar-selected-project';

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

  // Selected project for filtering (null = all projects)
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(
    () => {
      try {
        const stored = localStorage.getItem(SELECTED_PROJECT_KEY);
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    },
  );

  const handleSelectProject = useCallback((path: string | null) => {
    setSelectedProjectPath(path);
    try {
      localStorage.setItem(SELECTED_PROJECT_KEY, JSON.stringify(path));
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (selectedProjectPath === null) {
      return;
    }

    if (!projects.some((project) => project.path === selectedProjectPath)) {
      handleSelectProject(null);
    }
  }, [handleSelectProject, projects, selectedProjectPath]);

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

  // Filter projects by selected project path
  const displayProjects = useMemo(() => {
    if (selectedProjectPath === null) {
      return filteredProjects;
    }
    return filteredProjects.filter((p) => p.path === selectedProjectPath);
  }, [filteredProjects, selectedProjectPath]);

  // All projects for the rail (unfiltered by activity/selection - always show all)
  const allProjects = useMemo(() => {
    return projects;
  }, [projects]);

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
    selectedProjectPath,
    // Computed
    filteredProjects: displayProjects,
    allProjects,
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
    handleSelectProject,
  };
}
