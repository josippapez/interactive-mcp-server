import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  conversationToMarkdown,
  mergeMessages,
} from '../../types/unified-message';
import {
  getPromptComposerBaseDirectory,
  getPromptPlaceholder,
  getQueueComposerBaseDirectory,
} from './prompt-utils';
import { deriveBackgroundSubagents } from './background-subagents';
import { useDeriveSessionAgentEffect } from './useDeriveSessionAgentEffect';
import { usePromptConnectionData } from './usePromptConnectionData';
import { usePromptInteractionState } from './usePromptInteractionState';
import { usePromptModelState } from './usePromptModelState';
import { usePromptNavigationState } from './usePromptNavigationState';
import { usePromptProjectState } from './usePromptProjectState';
import { usePromptRuntimeState } from './usePromptRuntimeState';
import { usePromptSettingsState } from './usePromptSettingsState';
import type { PromptViewProps } from './prompt-view-types';
import { resolveSessionRepositoryRoot } from './session-repository-root';
import { resolveDisplayedSessionModel } from './session-model-display';

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

  const {
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
    pendingNewSessionAgent,
    setPendingNewSessionAgent,
  });

  const providerSessionId =
    activeNode?.providerSessionId ??
    (activeConnectionId?.startsWith('ses_') ? activeConnectionId : null);
  const isOpenCodeSession =
    activeNode?.providerType === 'opencode' || providerSessionId !== null;
  const sessionBaseDirectory = resolveSessionRepositoryRoot(
    activeNode ?? null,
    connections,
  );
  const backgroundSubagents = deriveBackgroundSubagents(
    connections,
    providerSessionId,
  );
  const {
    noReply,
    expandAllTools,
    showThinking,
    chatTextSize,
    toolAutoExpandExclusions,
    isOpenCodeBackendAvailable,
    handleNoReplyChange,
    handleExpandAllToolsChange,
    handleShowThinkingChange,
    handleChatTextSizeChange,
  } = usePromptSettingsState();

  const {
    mcpSettingsOpen,
    setMcpSettingsOpen,
    removeError,
    setRemoveError,
    tasksCollapsed,
    handleToggleTasksCollapsed,
    commandPaletteOpen,
    setCommandPaletteOpen,
    chatFullWidth,
    handleToggleChatFullWidth,
    reviewSidebarOpen,
    handleToggleReviewSidebar,
  } = usePromptInteractionState(activeConnectionId);

  const {
    currentModelOverride,
    handleModelSelect,
    handleSaveCreateModelSelection,
  } = usePromptModelState(providerSessionId);

  const {
    todos,
    todosLoading,
    todosError,
    refreshTodos,
    vcsInfo,
    reviewDiffs,
    reviewDiffSource,
    reviewDiffSourceOptions,
    reviewDiffLoading,
    reviewDiffError,
    setReviewDiffSource,
    refreshReviewDiffs,
    conversationMessages,
    conversationAvailable,
    conversationIsSeeding,
    currentModelId,
    currentProviderId,
    currentVariant,
    sessionModelSelection,
    runningContextWindow,
    sessionBusy,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    connectMcpServer,
    disconnectMcpServer,
    authenticateMcpServer,
    removeMcpServerAuth,
    activeSkills,
    latestStatus,
  } = usePromptConnectionData({
    providerSessionId,
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

  const displayedSessionModel = resolveDisplayedSessionModel({
    hasOverride: Boolean(sessionModelSelection.currentModelOverride),
    runningModel: {
      modelId: currentModelId,
      providerId: currentProviderId,
      variant: currentVariant,
    },
    selectedModel: {
      modelId: sessionModelSelection.modelId,
      providerId: sessionModelSelection.providerId,
      variant: sessionModelSelection.variant,
    },
  });

  useDeriveSessionAgentEffect({
    connectionId: activeConnectionId,
    conversationMessages,
  });

  const canAbort = Boolean(providerSessionId);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(-1);
  const [channelSearchOpen, setChannelSearchOpen] = useState(false);
  const [channelSearchMatchCount, setChannelSearchMatchCount] = useState(0);

  useEffect(() => {
    setActiveSearchMatchIndex(channelSearchMatchCount > 0 ? 0 : -1);
  }, [channelSearchMatchCount]);

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
    if (!providerSessionId) {
      return;
    }
    const result = await window.api.abortSession(providerSessionId);
    if (!result.success) {
      window.api.log?.(
        'warn',
        'PromptView',
        `Failed to abort session: ${result.error}`,
        providerSessionId,
      );
    }
  }, [providerSessionId]);

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

  const handleChannelSearchNext = useCallback(() => {
    if (channelSearchMatchCount === 0) return;
    setActiveSearchMatchIndex((prev) =>
      prev < 0 || prev >= channelSearchMatchCount - 1 ? 0 : prev + 1,
    );
  }, [channelSearchMatchCount]);

  const handleChannelSearchPrevious = useCallback(() => {
    if (channelSearchMatchCount === 0) return;
    setActiveSearchMatchIndex((prev) =>
      prev <= 0 ? channelSearchMatchCount - 1 : prev - 1,
    );
  }, [channelSearchMatchCount]);

  const handleChannelSearchClear = useCallback(() => {
    setChannelSearchQuery('');
    setActiveSearchMatchIndex(-1);
    setChannelSearchMatchCount(0);
  }, []);

  const previousConnectionIdRef = useRef<string | null>(activeConnectionId);

  useEffect(() => {
    if (previousConnectionIdRef.current === activeConnectionId) {
      return;
    }
    previousConnectionIdRef.current = activeConnectionId;
    setChannelSearchOpen(false);
    setChannelSearchQuery('');
    setActiveSearchMatchIndex(-1);
    setChannelSearchMatchCount(0);
  }, [activeConnectionId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== 'f') return;
      if (!activeConnectionId) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      setChannelSearchOpen(true);
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeConnectionId]);

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

  /**
   * Copy the full session transcript to the clipboard as Markdown. Uses
   * the same `mergeMessages` pipeline that the chat view renders, so the
   * copied content matches what the user sees (same ordering, same
   * filtering). Returns `true` on success, `false` if the clipboard API
   * fails or there is nothing to copy.
   */
  const handleCopyTranscript = useCallback(async (): Promise<boolean> => {
    const unified = mergeMessages(
      channelMessages,
      conversationMessages,
      activePromptId,
    );
    if (unified.length === 0) return false;
    const markdown = conversationToMarkdown(unified);
    if (!markdown) return false;
    try {
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch {
      return false;
    }
  }, [channelMessages, conversationMessages, activePromptId]);

  const handleOpenSessionLog = useCallback(async (): Promise<boolean> => {
    const sessionId = providerSessionId ?? activeConnectionId;
    if (!sessionId) return false;
    const result = await window.api.openSessionLog(sessionId);
    return result.ok;
  }, [activeConnectionId, providerSessionId]);

  const handleCopySessionLogPath = useCallback(async (): Promise<boolean> => {
    const sessionId = providerSessionId ?? activeConnectionId;
    if (!sessionId) return false;
    const path = await window.api.getSessionLogPath(sessionId);
    if (!path) return false;
    try {
      await navigator.clipboard.writeText(path);
      return true;
    } catch {
      return false;
    }
  }, [activeConnectionId, providerSessionId]);

  const handleToggleExpandAllTools = useCallback(() => {
    void handleExpandAllToolsChange(!expandAllTools);
  }, [expandAllTools, handleExpandAllToolsChange]);

  const handleToggleShowThinking = useCallback(() => {
    void handleShowThinkingChange(!showThinking);
  }, [handleShowThinkingChange, showThinking]);

  return {
    chatEndRef,
    activeNode,
    providerSessionId,
    isOpenCodeSession,
    parentInfo,
    handleNavigateToParent,
    handleNavigateToSession,
    backgroundSubagents,
    todos,
    todosLoading,
    todosError,
    refreshTodos,
    vcsInfo,
    reviewDiffs,
    reviewDiffSource,
    reviewDiffSourceOptions,
    reviewDiffLoading,
    reviewDiffError,
    setReviewDiffSource,
    refreshReviewDiffs,
    conversationMessages,
    conversationAvailable,
    conversationIsSeeding,
    currentModelId,
    currentProviderId,
    currentVariant,
    sessionModelSelection,
    displayedSessionModel,
    runningContextWindow,
    sessionBusy,
    sessionBaseDirectory,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    connectMcpServer,
    disconnectMcpServer,
    authenticateMcpServer,
    removeMcpServerAuth,
    activeSkills,
    mcpSettingsOpen,
    setMcpSettingsOpen,
    removeError,
    setRemoveError,
    noReply,
    tasksCollapsed,
    handleToggleTasksCollapsed,
    commandPaletteOpen,
    setCommandPaletteOpen,
    chatFullWidth,
    reviewSidebarOpen,
    expandAllTools,
    showThinking,
    chatTextSize,
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
    handleChatTextSizeChange,
    handleToggleReviewSidebar,
    handleModelSelect,
    handleCreateSession: handleCreateSessionWithModel,
    handleAddProject,
    handleNavigateToNewSession,
    handleRemoveSession,
    handleAbortSession,
    handleClearMessages,
    handleDismissCurrentSession,
    handleCopyTranscript,
    handleOpenSessionLog,
    handleCopySessionLogPath,
    channelSearchQuery,
    channelSearchOpen,
    channelSearchMatchCount,
    activeSearchMatchIndex,
    handleChannelSearchNext,
    handleChannelSearchPrevious,
    handleChannelSearchClear,
    setChannelSearchQuery,
    setChannelSearchOpen,
    setChannelSearchMatchCount,
    handleToggleChatFullWidth,
    handleToggleExpandAllTools,
    handleToggleShowThinking,
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
