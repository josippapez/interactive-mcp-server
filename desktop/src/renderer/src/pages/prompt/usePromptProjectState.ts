import { useCallback, useMemo, useState } from 'react';
import { usePinnedProjects } from '../../components/prompt/sidebar/usePinnedProjects';
import { toPinnedProjectOptions } from '../../hooks/session-tree-merge';
import { useSessionGraphProjects } from '../../store/session-graph';
import type { Attachment } from '../../types';
import type { PendingNewSessionAgent } from './pending-agent-assignment';

type CreateSessionModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
};

export function usePromptProjectState(
  onSelectConnection: (connectionId: string | null) => void,
) {
  const { pinnedPaths } = usePinnedProjects();
  const projects = useSessionGraphProjects(pinnedPaths);
  const pinnedProjects = useMemo(
    () => toPinnedProjectOptions(projects),
    [projects],
  );
  const [pendingNewSessionProject, setPendingNewSessionProject] = useState<
    string | null
  >(null);
  const [pendingSessionSelect, setPendingSessionSelect] = useState<
    string | null
  >(null);
  // Tracks the agent the user picked in `NewSessionInput` for a session that
  // has been created but not yet resolved to a renderer-side `connectionId`.
  // Once the session shows up in the connections map, the navigation hook
  // writes this into `sessionAgentsAtom` so the bottom-bar selector reflects
  // the user's choice instead of falling back to "default".
  const [pendingNewSessionAgent, setPendingNewSessionAgent] =
    useState<PendingNewSessionAgent | null>(null);

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
        window.api.log?.(
          'error',
          'PromptView',
          `Failed to create session: ${result.error}`,
        );
        return null;
      }

      if (result.sessionId) {
        setPendingSessionSelect(result.sessionId);
        const trimmedAgent = agent?.trim();
        if (trimmedAgent && trimmedAgent.length > 0) {
          setPendingNewSessionAgent({
            sessionId: result.sessionId,
            agent: trimmedAgent,
          });
        }
      }

      return result;
    },
    [],
  );

  const handleAddProject = useCallback(async (): Promise<string | null> => {
    const folderPath = await window.api.openFolderDialog();
    if (!folderPath || !folderPath.trim()) {
      return null;
    }

    const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
    if (!name.trim()) return null;
    await window.api.addPinnedProject(folderPath, name);
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
    pendingNewSessionAgent,
    setPendingNewSessionAgent,
    handleCreateSession,
    handleAddProject,
    handleNavigateToNewSession,
  };
}
