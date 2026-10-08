import { useCallback, useEffect, useState } from 'react';
import ChatHistoryView from '../components/prompt/ChatHistoryView';
import ChannelSidebar from '../components/prompt/ChannelSidebar';
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar';
import ChannelHeader from '../components/prompt/ChannelHeader';
import IdleStateView from '../components/prompt/IdleStateView';
import ActiveSessionBanner from '../components/prompt/ActiveSessionBanner';
import RemoveErrorBanner from '../components/prompt/RemoveErrorBanner';
import SessionIssueBanner from '../components/prompt/SessionIssueBanner';
import SessionTodoDock from '../components/prompt/SessionTodoDock';
import SessionInspectorSidebar from '../components/prompt/session-inspector-sidebar';
import SubagentSessionPane from '../components/prompt/subagent-session-pane';
import {
  closeSubagentSessionTab,
  openSubagentSessionTab,
  pruneSubagentSessionTabs,
} from '../components/prompt/subagent-session-pane-utils';
import McpSettingsModal from '../components/prompt/McpSettingsModal';
import { getQuestionDockLayout } from '../components/prompt/question-dock-display';
import { ContextUsageBar } from '../components/prompt/ContextUsageBar';
import { PromptComposerSection } from './prompt/PromptComposerSection';
import {
  getPromptComposerBaseDirectory,
  getPromptPlaceholder,
  getQueueComposerBaseDirectory,
} from './prompt/prompt-utils';
import type { PromptViewProps } from './prompt/prompt-view-types';
import { usePromptViewState } from './prompt/usePromptViewState';

export default function PromptView(props: PromptViewProps): React.ReactElement {
  const {
    connections,
    activeConnectionId,
    onSelectConnection,
    prompt,
    pendingQuestions,
    activeSession,
    channelMessages,
    connectionId,
    sessionChannel,
    docContextEnabled,
    onSubmit,
    onSubmitForSession,
    onSelectOption,
    onSelectOptionForSession,
    onQueueSessionMessage,
    onQueueSessionMessageForSession,
    onInjectWithReply,
    onInjectWithReplyForSession,
    onToggleDocContext,
    onToggleDocContextForSession,
    onEnsureSessionHistory,
    onReplyQuestion,
    onRejectQuestion,
    activeTab,
    onNavigate,
    onNewChat,
    onOpenSearch,
    rightPaneOverride,
  } = props;

  const view = usePromptViewState(props);
  const [openedSubagentSessionIds, setOpenedSubagentSessionIds] = useState<
    string[]
  >([]);
  const [activeSubagentSessionId, setActiveSubagentSessionId] = useState<
    string | null
  >(null);

  const promptComposerBaseDirectory = getPromptComposerBaseDirectory(
    prompt,
    activeConnectionId,
    connections,
  );
  const promptComposerPlaceholder = getPromptPlaceholder(
    prompt,
    activeConnectionId,
    connections,
  );
  const queueComposerBaseDirectory = getQueueComposerBaseDirectory(
    activeConnectionId,
    connections,
  );

  const contextUsageSessionId =
    view.providerSessionId ??
    (sessionChannel?.sessionId?.startsWith('ses_')
      ? sessionChannel.sessionId
      : null) ??
    (activeConnectionId?.startsWith('ses_') ? activeConnectionId : null);
  const showTodoDock = Boolean(
    view.isOpenCodeSession &&
    view.providerSessionId &&
    (view.todos.length > 0 || view.todosLoading || view.todosError),
  );
  const showInspectorSidebar = Boolean(
    view.isOpenCodeSession && view.reviewSidebarOpen,
  );
  const showSubagentSessionPane = Boolean(
    activeSubagentSessionId && openedSubagentSessionIds.length > 0,
  );
  const inspectorBadgeCount =
    view.backgroundSubagents.length +
    view.todos.filter(
      (todo) => todo.status === 'pending' || todo.status === 'in_progress',
    ).length +
    view.reviewDiffs.length;
  const questionDockLayout = getQuestionDockLayout(
    Boolean(pendingQuestions[0]),
  );

  const handleOpenSubagentTab = useCallback(
    (sessionId: string) => {
      if (sessionId === activeConnectionId) {
        return;
      }

      const matchedNode =
        connections.get(sessionId) ??
        [...connections.values()].find(
          (node) => node.providerSessionId === sessionId,
        );
      const resolvedSessionId = matchedNode?.id ?? null;
      if (!resolvedSessionId) {
        window.api.log?.(
          'warn',
          'PromptView',
          `Could not open subagent tab for session: ${sessionId}`,
          sessionId,
        );
        return;
      }

      setOpenedSubagentSessionIds((current) =>
        openSubagentSessionTab(current, resolvedSessionId),
      );
      setActiveSubagentSessionId(resolvedSessionId);
      onEnsureSessionHistory(resolvedSessionId);
    },
    [activeConnectionId, connections, onEnsureSessionHistory],
  );

  const handleCloseSubagentSession = useCallback(
    (sessionId: string) => {
      const next = closeSubagentSessionTab(
        openedSubagentSessionIds,
        activeSubagentSessionId,
        sessionId,
      );
      setOpenedSubagentSessionIds(next.sessionIds);
      setActiveSubagentSessionId(next.activeSessionId);
    },
    [activeSubagentSessionId, openedSubagentSessionIds],
  );

  const handleCloseSubagentPane = useCallback(() => {
    setOpenedSubagentSessionIds([]);
    setActiveSubagentSessionId(null);
  }, []);

  useEffect(() => {
    const next = pruneSubagentSessionTabs(
      openedSubagentSessionIds,
      activeSubagentSessionId,
      new Set(connections.keys()),
    );

    if (
      next.activeSessionId !== activeSubagentSessionId ||
      next.sessionIds.length !== openedSubagentSessionIds.length ||
      next.sessionIds.some(
        (sessionId, index) => sessionId !== openedSubagentSessionIds[index],
      )
    ) {
      setOpenedSubagentSessionIds(next.sessionIds);
      setActiveSubagentSessionId(next.activeSessionId);
    }
  }, [activeSubagentSessionId, connections, openedSubagentSessionIds]);

  useEffect(() => {
    if (!activeSubagentSessionId) {
      return;
    }

    onEnsureSessionHistory(activeSubagentSessionId);
  }, [activeSubagentSessionId, onEnsureSessionHistory]);

  return (
    <SidebarProvider defaultOpen className="flex h-full min-h-0 w-full">
      <div className="anim-prompt-shell h-full min-h-0 flex">
        <ChannelSidebar
          activeConnectionId={activeConnectionId}
          onSelect={onSelectConnection}
          onCreateSession={
            view.isOpenCodeBackendAvailable
              ? view.handleNavigateToNewSession
              : undefined
          }
          activeTab={activeTab}
          onNavigate={onNavigate}
          onNewChat={onNewChat}
          onOpenSearch={onOpenSearch}
        />
      </div>

      <SidebarInset className="anim-prompt-main flex-1 min-w-0 h-full min-h-0 bg-transparent">
        {rightPaneOverride ? (
          <div className="flex flex-1 min-w-0 h-full min-h-0 overflow-hidden">
            {rightPaneOverride}
          </div>
        ) : (
          <div className="relative flex flex-1 min-w-0 h-full min-h-0 flex-col">
            {activeConnectionId ? (
              <>
                <ChannelHeader
                  label={sessionChannel?.label ?? activeConnectionId}
                  sessionId={view.providerSessionId ?? activeConnectionId}
                  promptActive={Boolean(prompt)}
                  onClearMessages={view.handleClearMessages}
                  onRemoveSession={view.handleRemoveSession}
                  onDismissSession={view.handleDismissCurrentSession}
                  onAbortSession={view.handleAbortSession}
                  canAbort={view.canAbort}
                  vcsInfo={view.vcsInfo}
                  expandAllTools={view.expandAllTools}
                  onToggleExpandAllTools={view.handleToggleExpandAllTools}
                  showThinking={view.showThinking}
                  onToggleShowThinking={view.handleToggleShowThinking}
                  chatTextSize={view.chatTextSize}
                  onChatTextSizeChange={view.handleChatTextSizeChange}
                  chatFullWidth={view.chatFullWidth}
                  onToggleChatFullWidth={view.handleToggleChatFullWidth}
                  reviewOpen={showInspectorSidebar}
                  reviewCount={inspectorBadgeCount}
                  onToggleReview={
                    view.isOpenCodeSession
                      ? view.handleToggleReviewSidebar
                      : undefined
                  }
                  onCopyTranscript={view.handleCopyTranscript}
                  onOpenSessionLog={view.handleOpenSessionLog}
                  onCopySessionLogPath={view.handleCopySessionLogPath}
                  parentInfo={view.parentInfo}
                  onNavigateToParent={
                    view.parentInfo ? view.handleNavigateToParent : undefined
                  }
                  searchQuery={view.channelSearchQuery}
                  searchResultText={
                    view.channelSearchQuery
                      ? `${view.channelSearchMatchCount === 0 ? 0 : view.activeSearchMatchIndex + 1} / ${view.channelSearchMatchCount}`
                      : null
                  }
                  searchOpen={view.channelSearchOpen}
                  onSearchOpenChange={view.setChannelSearchOpen}
                  onSearchQueryChange={view.setChannelSearchQuery}
                  onSearchNext={view.handleChannelSearchNext}
                  onSearchPrevious={view.handleChannelSearchPrevious}
                  onSearchClear={view.handleChannelSearchClear}
                />

                {view.removeError && (
                  <RemoveErrorBanner
                    error={view.removeError}
                    onDismiss={() => view.setRemoveError(null)}
                  />
                )}

                <div className="flex-1 overflow-hidden flex flex-col">
                  {activeSession && (
                    <ActiveSessionBanner
                      sessionTitle={activeSession.title}
                      connectionId={connectionId}
                    />
                  )}
                  {/* Use the same fallback chain as ContextUsageBar —
                      `providerSessionId` is null for channels keyed
                      directly by the OpenCode session id. */}
                  <SessionIssueBanner sessionId={contextUsageSessionId} />
                  {!view.idle && (
                    <div
                      className="flex min-h-0 flex-1 overflow-hidden"
                      data-questions-open={
                        pendingQuestions[0] ? 'true' : 'false'
                      }
                    >
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        <ChatHistoryView
                          messages={channelMessages}
                          chatEndRef={view.chatEndRef}
                          activePromptId={view.activePromptId}
                          predefinedOptions={prompt?.predefinedOptions}
                          onSelectOption={onSelectOption}
                          lastReadMessageId={view.activeNode?.lastReadMessageId}
                          conversationMessages={view.conversationMessages}
                          showConversation={
                            view.isOpenCodeSession && view.conversationAvailable
                          }
                          isSeeding={view.conversationIsSeeding}
                          expandAllTools={view.expandAllTools}
                          toolAutoExpandExclusions={
                            view.toolAutoExpandExclusions
                          }
                          onNavigateToSession={handleOpenSubagentTab}
                          showThinking={view.showThinking}
                          chatTextSize={view.chatTextSize}
                          fullWidth={view.chatFullWidth}
                          isBusy={view.sessionBusy && view.isOpenCodeSession}
                          channelId={activeConnectionId}
                          searchQuery={view.channelSearchQuery}
                          activeSearchMatchIndex={view.activeSearchMatchIndex}
                          onSearchMatchesChange={
                            view.setChannelSearchMatchCount
                          }
                        />

                        {contextUsageSessionId && (
                          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]/40 px-2.5 py-1">
                            <ContextUsageBar
                              sessionId={contextUsageSessionId}
                              modelContextWindow={
                                view.runningContextWindow ??
                                view.sessionModelSelection.contextWindow
                              }
                              isBusy={
                                view.sessionBusy && view.isOpenCodeSession
                              }
                            />
                          </div>
                        )}

                        {showTodoDock && !showInspectorSidebar && (
                          <div className="px-3 pt-2 pb-1">
                            <SessionTodoDock
                              todos={view.todos}
                              isLoading={view.todosLoading}
                              error={view.todosError}
                              collapsed={view.tasksCollapsed}
                              onToggle={view.handleToggleTasksCollapsed}
                              onRefresh={view.refreshTodos}
                            />
                          </div>
                        )}

                        <PromptComposerSection
                          promptActive={Boolean(prompt)}
                          promptBaseDirectory={promptComposerBaseDirectory}
                          promptPlaceholder={promptComposerPlaceholder}
                          queueBaseDirectory={queueComposerBaseDirectory}
                          enabled={Boolean(sessionChannel)}
                          sessionChannelId={sessionChannel?.sessionId}
                          dispatchSessionId={activeConnectionId}
                          providerSessionId={view.providerSessionId}
                          sessionBaseDirectory={view.sessionBaseDirectory}
                          isOpenCodeSession={view.isOpenCodeSession}
                          noReply={view.noReply}
                          commandPaletteOpen={view.commandPaletteOpen}
                          modelId={view.displayedSessionModel.modelId}
                          providerId={view.displayedSessionModel.providerId}
                          variant={
                            view.displayedSessionModel.variant ?? undefined
                          }
                          activeSkills={view.activeSkills}
                          connectionId={activeConnectionId}
                          docContextEnabled={docContextEnabled}
                          pendingQuestion={pendingQuestions[0]}
                          questionDockLayout={questionDockLayout}
                          onSubmit={onSubmit}
                          onQueueSubmit={(text, attachments) => {
                            if (activeConnectionId) {
                              onQueueSessionMessage(
                                activeConnectionId,
                                text,
                                attachments,
                              );
                            }
                          }}
                          onSubmitWithReply={onInjectWithReply}
                          onNoReplyChange={view.handleNoReplyChange}
                          onCommandPaletteChange={view.setCommandPaletteOpen}
                          onModelSelect={view.handleModelSelect}
                          onToggleDocContext={onToggleDocContext}
                          onReplyQuestion={onReplyQuestion}
                          onRejectQuestion={onRejectQuestion}
                          mcpStatus={
                            view.isOpenCodeSession
                              ? {
                                  servers: view.mcpServers,
                                  isLoading: view.mcpLoading,
                                  error: view.mcpError,
                                  onRefresh: view.refreshMcpServers,
                                  onConnect: view.connectMcpServer,
                                  onDisconnect: view.disconnectMcpServer,
                                  onAuthenticate: view.authenticateMcpServer,
                                  onRemoveAuth: view.removeMcpServerAuth,
                                  onOpenSettings: () =>
                                    view.setMcpSettingsOpen(true),
                                }
                              : undefined
                          }
                          currentModelOverride={
                            view.sessionModelSelection.currentModelOverride
                          }
                        />
                      </div>
                      {showSubagentSessionPane && activeSubagentSessionId && (
                        <SubagentSessionPane
                          connections={connections}
                          sessionIds={openedSubagentSessionIds}
                          activeSessionId={activeSubagentSessionId}
                          onActiveSessionChange={setActiveSubagentSessionId}
                          onCloseSession={handleCloseSubagentSession}
                          onClosePane={handleCloseSubagentPane}
                          onOpenInMain={view.handleNavigateToSession}
                          onOpenSessionTab={handleOpenSubagentTab}
                          onSubmitForSession={onSubmitForSession}
                          onSelectOptionForSession={onSelectOptionForSession}
                          onQueueSessionMessageForSession={
                            onQueueSessionMessageForSession
                          }
                          onInjectWithReplyForSession={
                            onInjectWithReplyForSession
                          }
                          onToggleDocContextForSession={
                            onToggleDocContextForSession
                          }
                          onReplyQuestion={onReplyQuestion}
                          onRejectQuestion={onRejectQuestion}
                          noReply={view.noReply}
                          onNoReplyChange={view.handleNoReplyChange}
                          commandPaletteOpen={view.commandPaletteOpen}
                          onCommandPaletteChange={view.setCommandPaletteOpen}
                          expandAllTools={view.expandAllTools}
                          toolAutoExpandExclusions={
                            view.toolAutoExpandExclusions
                          }
                          showThinking={view.showThinking}
                          chatTextSize={view.chatTextSize}
                        />
                      )}
                      {showInspectorSidebar && (
                        <SessionInspectorSidebar
                          backgroundSubagents={view.backgroundSubagents}
                          todos={view.todos}
                          todosLoading={view.todosLoading}
                          todosError={view.todosError}
                          tasksCollapsed={view.tasksCollapsed}
                          onToggleTasksCollapsed={
                            view.handleToggleTasksCollapsed
                          }
                          onRefreshTodos={view.refreshTodos}
                          reviewDiffs={view.reviewDiffs}
                          reviewSessionId={activeConnectionId ?? ''}
                          onSubmitReviewComment={onInjectWithReply}
                          reviewSource={view.reviewDiffSource}
                          reviewSourceOptions={view.reviewDiffSourceOptions}
                          reviewLoading={view.reviewDiffLoading}
                          reviewError={view.reviewDiffError}
                          onReviewSourceChange={view.setReviewDiffSource}
                          onRefreshReview={view.refreshReviewDiffs}
                          onOpenSessionTab={handleOpenSubagentTab}
                          onClose={view.handleToggleReviewSidebar}
                        />
                      )}
                    </div>
                  )}
                  {view.idle && (
                    <IdleStateView
                      isOpenCodeAvailable={view.isOpenCodeBackendAvailable}
                      onCreateSession={view.handleCreateSession}
                      pinnedProjects={view.pinnedProjects}
                      onAddProject={view.handleAddProject}
                      preSelectedProject={view.pendingNewSessionProject}
                      onClearPreSelectedProject={() =>
                        view.setPendingNewSessionProject(null)
                      }
                    />
                  )}
                </div>
              </>
            ) : view.pendingNewSessionProject ||
              view.isOpenCodeBackendAvailable ? (
              <div className="flex-1 overflow-hidden flex flex-col">
                <IdleStateView
                  isOpenCodeAvailable={view.isOpenCodeBackendAvailable}
                  onCreateSession={view.handleCreateSession}
                  pinnedProjects={view.pinnedProjects}
                  onAddProject={view.handleAddProject}
                  preSelectedProject={view.pendingNewSessionProject}
                  onClearPreSelectedProject={() =>
                    view.setPendingNewSessionProject(null)
                  }
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                No channels yet.
              </div>
            )}
          </div>
        )}
      </SidebarInset>

      <McpSettingsModal
        isOpen={view.mcpSettingsOpen}
        onClose={() => view.setMcpSettingsOpen(false)}
        servers={view.mcpServers}
        directory={view.sessionBaseDirectory ?? undefined}
        onRefresh={view.refreshMcpServers}
        onConnect={view.connectMcpServer}
        onDisconnect={view.disconnectMcpServer}
        onAuthenticate={view.authenticateMcpServer}
        onRemoveAuth={view.removeMcpServerAuth}
      />
    </SidebarProvider>
  );
}
