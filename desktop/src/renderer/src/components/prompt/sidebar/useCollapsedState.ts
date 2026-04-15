import { useState, useCallback } from 'react';
import { COLLAPSED_PROJECTS_KEY, COLLAPSED_SESSIONS_KEY } from './types';

/**
 * Hook for managing collapsed state of projects and sessions.
 */
export function useCollapsedState() {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => {
      const saved = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    },
  );

  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(
    () => {
      const saved = localStorage.getItem(COLLAPSED_SESSIONS_KEY);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    },
  );

  const handleToggleProject = useCallback((projectPath: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleToggleSession = useCallback((sessionId: string) => {
    setCollapsedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      localStorage.setItem(COLLAPSED_SESSIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  return {
    collapsedProjects,
    collapsedSessions,
    handleToggleProject,
    handleToggleSession,
  };
}
