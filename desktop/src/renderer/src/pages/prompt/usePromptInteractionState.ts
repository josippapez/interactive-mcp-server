import { useCallback, useEffect, useState } from 'react';

export function usePromptInteractionState(activeConnectionId: string | null) {
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [tasksSidebarCollapsed, setTasksSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    setRemoveError(null);
  }, [activeConnectionId]);

  const handleToggleTasksSidebar = useCallback(() => {
    setTasksSidebarCollapsed((prev) => !prev);
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
  };
}
