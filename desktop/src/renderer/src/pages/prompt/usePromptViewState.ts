import { useCallback, useEffect, useRef } from 'react';
import {
  getPromptComposerBaseDirectory,
  getPromptPlaceholder,
  getQueueComposerBaseDirectory,
} from './prompt-utils';
import { usePromptConnectionData } from './usePromptConnectionData';
import { usePromptInteractionState } from './usePromptInteractionState';
import { usePromptModelState } from './usePromptModelState';
import { usePromptNavigationState } from './usePromptNavigationState';
import { usePromptProjectState } from './usePromptProjectState';
import { usePromptRuntimeState } from './usePromptRuntimeState';
import { usePromptSettingsState } from './usePromptSettingsState';
import type { PromptViewProps } from './prompt-view-types';

export function usePromptViewState(props: PromptViewProps) {
  const {
    connections,
    activeConnectionId,
    connectionId,
    sessionChannel,
    sessionStatuses,
    onSelectConnection,
    prompt,
    activeSession,
    channelMessages,
    onClearMessages,
    onRemoveSession,
    onDismissSession,
  } = props;

  const chatEndRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  const {
    pinnedProjects,
    pendingNewSessionProject,
    setPendingNewSessionProject,
    pendingSessionSelect,
    setPendingSessionSelect,
    handleCreateSession,
    handleAddProject,
    handleNavigateToNewSession,
  } = usePromptProjectState(onSelectConnection);

  const {
    activeNode,
    parentInfo,
    sessionActionTarget,
    handleNavigateToParent,
    handleNavigateToSession,
  } = usePromptNavigationState({
    connections,
    activeConnectionId,
    connectionId,
    sessionChannelId: sessionChannel?.sessionId ?? null,
    pendingSessionSelect,
    onSelectConnection,
    setPendingSessionSelect,
  });

  const openCodeSessionId = activeNode?.openCodeSessionId ?? null;
  const isOpenCodeSession = activeNode?.providerType === 'opencode';
  const sessionBaseDirectory =
    activeNode?.baseDirectory ?? activeNode?.directory ?? null;

  const {
    noReply,
    expandAllTools,
    showThinking,
    toolAutoExpandExclusions,
    isOpenCodeBackendAvailable,
    handleNoReplyChange,
    handleExpandAllToolsChange,
    handleShowThinkingChange,
  } = usePromptSettingsState();

  const {
    mcpSettingsOpen,
    setMcpSettingsOpen,
    removeError,
    setRemoveError,
    tasksSidebarCollapsed,
    handleToggleTasksSidebar,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = usePromptInteractionState(activeConnectionId);

  const {
    currentModelOverride,
    handleModelSelect,
    handleSaveCreateModelSelection,
  } = usePromptModelState(openCodeSessionId);

  const {
    todos,
    todosLoading,
    todosError,
    refreshTodos,
    vcsInfo,
    conversationMessages,
    conversationAvailable,
    currentModelId,
    currentProviderId,
    sessionModelSelection,
    sessionBusy,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    latestStatus,
  } = usePromptConnectionData({
    openCodeSessionId,
    isOpenCodeSession,
    sessionBaseDirectory,
    sessionStatuses,
  });

  const { idle, activePromptId, secondsLeft } = usePromptRuntimeState({
    prompt,
    activeSession,
    channelMessages,
    conversationMessagesLength: conversationMessages.length,
    activeConnectionId,
  });

  const canAbort = Boolean(openCodeSessionId);

  useEffect(() => {
    if (!sessionActionTarget) {
      return;
    }
    setRemoveError(null);
  }, [sessionActionTarget, setRemoveError]);

  const handleRemoveSession = useCallback(async () => {
    if (!sessionActionTarget) {
      return;
    }
    const ok = await onRemoveSession(sessionActionTarget);
    if (!ok) {
      setRemoveError(
        'Failed to remove session. The channel data was cleaned up but the agent transport may still be active.',
      );
      return;
    }
    setRemoveError(null);
  }, [onRemoveSession, sessionActionTarget, setRemoveError]);

  const handleAbortSession = useCallback(async () => {
    if (!openCodeSessionId) {
      return;
    }
    const result = await window.api.abortSession(openCodeSessionId);
    if (!result.success) {
      console.warn('[PromptView] Failed to abort session:', result.error);
    }
  }, [openCodeSessionId]);

  const handleClearMessages = useCallback(() => {
    if (sessionActionTarget) {
      onClearMessages(sessionActionTarget);
    }
  }, [onClearMessages, sessionActionTarget]);

  const handleDismissCurrentSession = useCallback(() => {
    if (sessionActionTarget) {
      onDismissSession(sessionActionTarget);
    }
  }, [onDismissSession, sessionActionTarget]);

  const handleCreateSessionWithModel = useCallback(
    async (...args: Parameters<typeof handleCreateSession>) => {
      const result = await handleCreateSession(...args);
      if (!result?.sessionId) {
        return;
      }
      handleSaveCreateModelSelection(result.sessionId, args[3]);
    },
    [handleCreateSession, handleSaveCreateModelSelection],
  );

  return {
    chatEndRef,
    layoutRef,
    activeNode,
    openCodeSessionId,
    isOpenCodeSession,
    parentInfo,
    handleNavigateToParent,
    handleNavigateToSession,
    todos,
    todosLoading,
    todosError,
    refreshTodos,
    vcsInfo,
    conversationMessages,
    conversationAvailable,
    currentModelId,
    currentProviderId,
    sessionModelSelection,
    sessionBusy,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    mcpSettingsOpen,
    setMcpSettingsOpen,
    removeError,
    setRemoveError,
    noReply,
    tasksSidebarCollapsed,
    commandPaletteOpen,
    setCommandPaletteOpen,
    expandAllTools,
    showThinking,
    toolAutoExpandExclusions,
    isOpenCodeBackendAvailable,
    pinnedProjects,
    pendingNewSessionProject,
    setPendingNewSessionProject,
    currentModelOverride,
    idle,
    secondsLeft,
    canAbort,
    latestStatus,
    activePromptId,
    handleNoReplyChange,
    handleExpandAllToolsChange,
    handleShowThinkingChange,
    handleModelSelect,
    handleCreateSession: handleCreateSessionWithModel,
    handleAddProject,
    handleNavigateToNewSession,
    handleRemoveSession,
    handleAbortSession,
    handleClearMessages,
    handleDismissCurrentSession,
    handleToggleTasksSidebar,
    handleToggleExpandAllTools: () =>
      void handleExpandAllToolsChange(!expandAllTools),
    handleToggleShowThinking: () =>
      void handleShowThinkingChange(!showThinking),
    promptComposerBaseDirectory: getPromptComposerBaseDirectory(
      prompt,
      activeConnectionId,
      connections,
    ),
    promptComposerPlaceholder: getPromptPlaceholder(
      prompt,
      activeConnectionId,
      connections,
    ),
    queueComposerBaseDirectory: getQueueComposerBaseDirectory(
      activeConnectionId,
      connections,
    ),
  };
}
