import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSessionStatus } from '../../../hooks/useSessionStatus';
import { useCollapsedState } from './useCollapsedState';
import { usePinnedProjects } from './usePinnedProjects';
import { useSessionFiltering } from './useSessionFiltering';
import {
  sessionGraphStore,
  setSessionGraphNodes,
  useSessionGraphProjects,
  useSessionGraphSelector,
} from '../../../store/session-graph';
import { useHealthStatus } from '../../../store/opencode-health';
import { applyOptimisticArchiveState } from '../../../hooks/session-tree-merge';
import {
  getBulkArchiveSessionIds,
  getVisibleSessionIds,
  resolveSessionSelection,
} from './session-multi-select';

/** Local storage key for persisted selected project */
const SELECTED_PROJECT_KEY = 'sidebar-selected-project';
const SHOW_ARCHIVED_KEY = 'sidebar-show-archived';
const MIN_REFRESH_SPINNER_MS = 350;

type UseSidebarStateProps = {
  onSelect: (id: string) => void;
};

/**
 * Main orchestrating hook that composes smaller focused hooks.
 *
 * Width/resize is now owned by the shadcn `<SidebarProvider>` (cookie-based
 * expand/collapse via `--sidebar-width`); this hook no longer exposes
 * sidebarRef/sidebarWidth/isResizing/handleMouseDown.
 */
export function useSidebarState({ onSelect }: UseSidebarStateProps) {
  // Pinned projects management
  const {
    pinnedPaths,
    handleAddProject,
    handlePinProject,
    handleRemoveProject,
  } = usePinnedProjects();

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

  // Tell the main process which folder is selected. The main process scopes
  // every OpenCode session-list fetch (seed, poller, reconcile) to this
  // folder. When null, nothing is fetched and the sidebar renders empty.
  useEffect(() => {
    void window.api.setSelectedFolder(selectedProjectPath);
  }, [selectedProjectPath]);

  // Refresh state
  const [isUserRefreshing, setIsUserRefreshing] = useState(false);
  const [loadingMoreProjectPath, setLoadingMoreProjectPath] = useState<
    string | null
  >(null);
  const [showArchived, setShowArchived] = useState(() => {
    try {
      return localStorage.getItem(SHOW_ARCHIVED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void window.api.setShowArchivedSessionTree?.(showArchived);
    try {
      localStorage.setItem(SHOW_ARCHIVED_KEY, String(showArchived));
    } catch {
      // Ignore storage errors
    }
  }, [showArchived]);

  // Session status from OpenCode API
  const {
    getStatus,
    statusMap,
    refresh: refreshSessionStatus,
  } = useSessionStatus(true);

  const handleRefresh = useCallback(async () => {
    if (isUserRefreshing) return;
    setIsUserRefreshing(true);
    const startedAt = Date.now();
    try {
      await Promise.all([
        window.api.refreshSessionTree(),
        refreshSessionStatus(),
      ]);
    } finally {
      const remaining = MIN_REFRESH_SPINNER_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        window.setTimeout(() => setIsUserRefreshing(false), remaining);
      } else {
        setIsUserRefreshing(false);
      }
    }
  }, [isUserRefreshing, refreshSessionStatus]);

  const handleLoadMoreSessions = useCallback(
    async (baseDirectory: string) => {
      if (loadingMoreProjectPath !== null) return;
      setLoadingMoreProjectPath(baseDirectory);
      try {
        await window.api.loadMoreSessionTree?.(baseDirectory);
      } finally {
        setLoadingMoreProjectPath(null);
      }
    },
    [loadingMoreProjectPath],
  );

  const handleToggleArchived = useCallback(() => {
    setShowArchived((current) => !current);
  }, []);

  // Show the spinner as rotating during cold-start while OpenCode is still
  // coming up and we don't yet have any projects to display. As soon as the
  // backend is healthy and the retry loop has populated the session tree,
  // the spinner stops. Merged with the user-clicked-refresh flag so manual
  // refreshes still animate.
  const healthStatus = useHealthStatus();
  const isColdStartLoading = !healthStatus.healthy && projects.length === 0;
  const isRefreshing = isUserRefreshing || isColdStartLoading;

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
    filteredProjects,
    filteredDirectConnections,
    providerCounts,
    providerTabs,
    runningCount,
  } = useSessionFiltering({
    openCodeTree,
    directConnections,
    projects,
    getStatus,
    statusMap,
  });

  // Filter projects by selected project path
  const displayProjects = useMemo(() => {
    if (selectedProjectPath === null) {
      return filteredProjects;
    }
    return filteredProjects.filter((p) => p.path === selectedProjectPath);
  }, [filteredProjects, selectedProjectPath]);

  const visibleSessionIds = useMemo(
    () => getVisibleSessionIds(displayProjects, collapsedSessions),
    [collapsedSessions, displayProjects],
  );

  const handleSelectSession = useCallback(
    (sessionId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      const providerSessionId =
        sessionGraphStore.state.nodes.get(sessionId)?.providerSessionId ??
        sessionId;
      const toggleKey = event.metaKey || event.ctrlKey;

      if (event.shiftKey || toggleKey) {
        event.preventDefault();
        const result = resolveSessionSelection({
          current: selectedSessionIds,
          clickedId: providerSessionId,
          visibleIds: visibleSessionIds,
          anchorId: selectionAnchorId,
          shiftKey: event.shiftKey,
          toggleKey,
        });
        setSelectedSessionIds(result.selectedIds);
        setSelectionAnchorId(result.anchorId);
        return;
      }

      setSelectedSessionIds(new Set());
      setSelectionAnchorId(providerSessionId);
      onSelect(sessionId);
    },
    [onSelect, selectedSessionIds, selectionAnchorId, visibleSessionIds],
  );

  const handleArchiveSession = useCallback(
    async (sessionId: string, archived: boolean) => {
      const nodes = sessionGraphStore.state.nodes;
      const targetSessionIds = getBulkArchiveSessionIds(
        nodes,
        selectedSessionIds,
        sessionId,
      );

      let optimisticNodes = nodes;
      for (const targetSessionId of targetSessionIds) {
        optimisticNodes = applyOptimisticArchiveState(
          optimisticNodes,
          targetSessionId,
          archived,
          showArchived,
        );
      }
      setSessionGraphNodes(optimisticNodes);
      setSelectedSessionIds(new Set());
      setSelectionAnchorId(null);

      const results = await Promise.all(
        targetSessionIds.map((targetSessionId) =>
          window.api.archiveOpenCodeSession?.(targetSessionId, archived),
        ),
      );
      if (results.some((ok) => !ok)) {
        await window.api.refreshSessionTree?.();
        return;
      }
      await window.api.refreshSessionTree?.();
    },
    [selectedSessionIds, showArchived],
  );

  // All projects for the rail (unfiltered by activity/selection - always show all)
  const allProjects = useMemo(() => {
    return projects;
  }, [projects]);

  return {
    // State
    filter,
    setFilter,
    collapsedProjects,
    collapsedSessions,
    isRefreshing,
    selectedProjectPath,
    loadingMoreProjectPath,
    showArchived,
    // Computed
    filteredProjects: displayProjects,
    allProjects,
    filteredDirectConnections,
    providerCounts,
    providerTabs,
    runningCount,
    // Status
    getStatus,
    // Handlers
    handleRefresh,
    handleToggleProject,
    handleToggleSession,
    handleAddProject,
    handlePinProject,
    handleRemoveProject,
    handleSelectProject,
    handleLoadMoreSessions,
    handleToggleArchived,
    handleArchiveSession,
    handleSelectSession,
    selectedSessionIds,
  };
}
