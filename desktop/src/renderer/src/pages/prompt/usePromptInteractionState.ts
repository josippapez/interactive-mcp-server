import { useCallback, useEffect, useState } from 'react';

const FULL_WIDTH_CHAT_STORAGE_KEY = 'prompt-chat-full-width';

export function usePromptInteractionState(activeConnectionId: string | null) {
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [tasksSidebarCollapsed, setTasksSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [chatFullWidth, setChatFullWidth] = useState(() => {
    try {
      return localStorage.getItem(FULL_WIDTH_CHAT_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setRemoveError(null);
  }, [activeConnectionId]);

  const handleToggleTasksSidebar = useCallback(() => {
    setTasksSidebarCollapsed((prev) => !prev);
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

  return {
    mcpSettingsOpen,
    setMcpSettingsOpen,
    removeError,
    setRemoveError,
    tasksSidebarCollapsed,
    handleToggleTasksSidebar,
    commandPaletteOpen,
    setCommandPaletteOpen,
    chatFullWidth,
    handleToggleChatFullWidth,
  };
}
