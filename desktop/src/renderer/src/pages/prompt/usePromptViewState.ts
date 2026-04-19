import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPromptComposerBaseDirectory,
  getPromptPlaceholder,
  getQueueComposerBaseDirectory,
} from './prompt-utils';
import { useDeriveSessionAgentEffect } from './useDeriveSessionAgentEffect';
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

  const providerSessionId = activeNode?.providerSessionId ?? null;
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
  } = usePromptModelState(providerSessionId);

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
    connectMcpServer,
    disconnectMcpServer,
    authenticateMcpServer,
    removeMcpServerAuth,
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
      console.warn('[PromptView] Failed to abort session:', result.error);
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

  const handleSelectProjectSession = useCallback(
    (projectPath: string | null) => {
      if (!projectPath) {
        return;
      }

      const matchingRoots = Array.from(connections.entries())
        .filter(([, node]) => !node.isDirectConnection)
        .filter(
          ([, node]) => (node.baseDirectory ?? node.directory) === projectPath,
        )
        .sort(([, left], [, right]) => {
          const rightUpdated = right.createdAt ?? 0;
          const leftUpdated = left.createdAt ?? 0;
          return rightUpdated - leftUpdated;
        });

      const next = matchingRoots[0]?.[0] ?? null;
      if (next && next !== activeConnectionId) {
        onSelectConnection(next);
      }
    },
    [activeConnectionId, connections, onSelectConnection],
  );

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
    providerSessionId,
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
    sessionBaseDirectory,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    connectMcpServer,
    disconnectMcpServer,
    authenticateMcpServer,
    removeMcpServerAuth,
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
    handleSelectProjectSession,
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
