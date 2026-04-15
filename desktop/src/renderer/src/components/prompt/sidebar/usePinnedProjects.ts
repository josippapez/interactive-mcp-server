import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing pinned projects.
 */
export function usePinnedProjects() {
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);

  // Load pinned projects on mount
  useEffect(() => {
    window.api.getPinnedProjects().then((pinned) => {
      setPinnedPaths(pinned.map((p) => p.path));
    });
  }, []);

  const handleAddProject = useCallback(async () => {
    const folderPath = await window.api.openFolderDialog();
    if (!folderPath) return;

    const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
    await window.api.addPinnedProject(folderPath, name);
    setPinnedPaths((prev) => [...prev, folderPath]);
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
