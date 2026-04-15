import { useCallback, useEffect, useState } from 'react';

const POLL_EXCLUSIONS_MS = 5000;

export function usePromptSettingsState() {
  const [noReply, setNoReply] = useState(true);
  const [expandAllTools, setExpandAllTools] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [toolAutoExpandExclusions, setToolAutoExpandExclusions] = useState<
    string[]
  >([]);
  const [isOpenCodeBackendAvailable, setIsOpenCodeBackendAvailable] =
    useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const settings = await window.api.getSettings();
      setNoReply(settings.defaultNoReply ?? true);
      setExpandAllTools(settings.defaultExpandAllTools ?? false);
      setShowThinking(settings.defaultShowThinking ?? false);
      setToolAutoExpandExclusions(settings.toolAutoExpandExclusions ?? []);
      setIsOpenCodeBackendAvailable(settings.agentBackend === 'opencode');
    };
    void loadSettings();
  }, []);

  useEffect(() => {
    const loadExclusions = async () => {
      const settings = await window.api.getSettings();
      setToolAutoExpandExclusions(settings.toolAutoExpandExclusions ?? []);
    };

    const interval = setInterval(loadExclusions, POLL_EXCLUSIONS_MS);
    return () => clearInterval(interval);
  }, []);

  const saveSettingsPatch = useCallback(
    async (patch: Record<string, unknown>) => {
      const settings = await window.api.getSettings();
      await window.api.saveSettings({ ...settings, ...patch });
    },
    [],
  );

  const handleNoReplyChange = useCallback(
    async (value: boolean) => {
      setNoReply(value);
      await saveSettingsPatch({ defaultNoReply: value });
    },
    [saveSettingsPatch],
  );

  const handleExpandAllToolsChange = useCallback(
    async (value: boolean) => {
      setExpandAllTools(value);
      await saveSettingsPatch({ defaultExpandAllTools: value });
    },
    [saveSettingsPatch],
  );

  const handleShowThinkingChange = useCallback(
    async (value: boolean) => {
      setShowThinking(value);
      await saveSettingsPatch({ defaultShowThinking: value });
    },
    [saveSettingsPatch],
  );

  return {
    noReply,
    expandAllTools,
    showThinking,
    toolAutoExpandExclusions,
    isOpenCodeBackendAvailable,
    handleNoReplyChange,
    handleExpandAllToolsChange,
    handleShowThinkingChange,
  };
}
