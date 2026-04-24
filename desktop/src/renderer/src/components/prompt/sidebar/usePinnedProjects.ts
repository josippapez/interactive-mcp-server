import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing pinned projects.
 *
 * Re-fetches whenever the main process broadcasts `pinned-projects:updated`
 * so every consumer of this hook stays in sync when a project is pinned or
 * removed from any surface (sidebar rail, Settings, project picker).
 */
export function usePinnedProjects() {
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      window.api.getPinnedProjects().then((pinned) => {
        if (cancelled) return;
        setPinnedPaths(pinned.map((p) => p.path));
      });
    };

    load();
    const unsubscribe = window.api.onPinnedProjectsUpdated?.(load);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleAddProject = useCallback(async () => {
    const folderPath = await window.api.openFolderDialog();
    if (!folderPath) return;

    const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
    await window.api.addPinnedProject(folderPath, name);
    // Main broadcasts pinned-projects:updated, which will trigger a refetch
    // in every hook instance. Still update local state immediately for
    // snappy UI in this instance.
    setPinnedPaths((prev) =>
      prev.includes(folderPath) ? prev : [...prev, folderPath],
    );
  }, []);

  const handleRemoveProject = useCallback(async (projectPath: string) => {
    await window.api.removePinnedProject(projectPath);
    setPinnedPaths((prev) => prev.filter((p) => p !== projectPath));
  }, []);

  return {
    pinnedPaths,
    handleAddProject,
    handleRemoveProject,
  };
}
