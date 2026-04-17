import { useCallback, useEffect, useState } from 'react';
import type { Attachment } from '../../types';

type CreateSessionModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
};

export function usePromptProjectState(
  onSelectConnection: (connectionId: string | null) => void,
) {
  const [pinnedProjects, setPinnedProjects] = useState<
    { path: string; name: string }[]
  >([]);
  const [pendingNewSessionProject, setPendingNewSessionProject] = useState<
    string | null
  >(null);
  const [pendingSessionSelect, setPendingSessionSelect] = useState<
    string | null
  >(null);

  useEffect(() => {
    const loadPinnedProjects = async () => {
      const projects = await window.api.getPinnedProjects();
      setPinnedProjects(projects.map((p) => ({ path: p.path, name: p.name })));
    };
    void loadPinnedProjects();
  }, []);

  const handleCreateSession = useCallback(
    async (
      initialMessage: string,
      baseDirectory: string,
      attachments?: Attachment[],
      modelSelection?: CreateSessionModelSelection,
      agent?: string,
    ) => {
      const result = await window.api.createOpenCodeSession({
        initialMessage,
        baseDirectory,
        attachments,
        modelSelection,
        agent,
      });

      if (!result.ok) {
        console.error('[PromptView] Failed to create session:', result.error);
        return null;
      }

      if (result.sessionId) {
        setPendingSessionSelect(result.sessionId);
      }

      return result;
    },
    [],
  );

  const handleAddProject = useCallback(async (): Promise<string | null> => {
    const folderPath = await window.api.openFolderDialog();
    if (!folderPath) {
      return null;
    }

    const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
    await window.api.addPinnedProject(folderPath, name);
    setPinnedProjects((prev) => [...prev, { path: folderPath, name }]);
    return folderPath;
  }, []);

  const handleNavigateToNewSession = useCallback(
    (baseDirectory: string) => {
      setPendingNewSessionProject(baseDirectory);
      onSelectConnection(null);
    },
    [onSelectConnection],
  );

  return {
    pinnedProjects,
    pendingNewSessionProject,
    setPendingNewSessionProject,
    pendingSessionSelect,
    setPendingSessionSelect,
    handleCreateSession,
    handleAddProject,
    handleNavigateToNewSession,
  };
}
