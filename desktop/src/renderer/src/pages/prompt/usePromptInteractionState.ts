import { useCallback, useEffect, useState } from 'react';

const FULL_WIDTH_CHAT_STORAGE_KEY = 'prompt-chat-full-width';
const REVIEW_SIDEBAR_STORAGE_KEY = 'prompt-review-sidebar-open';

export function usePromptInteractionState(activeConnectionId: string | null) {
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [tasksCollapsed, setTasksCollapsed] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [chatFullWidth, setChatFullWidth] = useState(() => {
    try {
      return localStorage.getItem(FULL_WIDTH_CHAT_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [reviewSidebarOpen, setReviewSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(REVIEW_SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setRemoveError(null);
  }, [activeConnectionId]);

  // Reset the inline task dock whenever the active session changes so the
  // previous channel's collapsed state does not bleed across sessions.
  useEffect(() => {
    setTasksCollapsed(true);
  }, [activeConnectionId]);

  const handleToggleTasksCollapsed = useCallback(() => {
    setTasksCollapsed((prev) => !prev);
  }, []);

  const handleToggleChatFullWidth = useCallback(() => {
    setChatFullWidth((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FULL_WIDTH_CHAT_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }, []);

  const handleToggleReviewSidebar = useCallback(() => {
    setReviewSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(REVIEW_SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }, []);

  return {
    mcpSettingsOpen,
    setMcpSettingsOpen,
    removeError,
    setRemoveError,
    tasksCollapsed,
    handleToggleTasksCollapsed,
    reviewSidebarOpen,
    handleToggleReviewSidebar,
    commandPaletteOpen,
    setCommandPaletteOpen,
    chatFullWidth,
    handleToggleChatFullWidth,
  };
}
