import PromptMessage from '../components/prompt/PromptMessage';
import ChatHistoryView from '../components/prompt/ChatHistoryView';
import ChannelSidebar from '../components/prompt/ChannelSidebar';
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar';
import ChannelHeader from '../components/prompt/ChannelHeader';
import IdleStateView from '../components/prompt/IdleStateView';
import ActiveSessionBanner from '../components/prompt/ActiveSessionBanner';
import RemoveErrorBanner from '../components/prompt/RemoveErrorBanner';
import TasksSidebar from '../components/prompt/TasksSidebar';
import McpStatusPanel from '../components/prompt/McpStatusPanel';
import McpSettingsModal from '../components/prompt/McpSettingsModal';
import QuestionDock from '../components/prompt/QuestionDock';
import { ContextUsageBar } from '../components/prompt/ContextUsageBar';
import { PromptComposerSection } from './prompt/PromptComposerSection';
import React from 'react';
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
    onSelectOption,
    onDismissStatus,
    onQueueSessionMessage,
    onInjectWithReply,
    onToggleDocContext,
    onReplyQuestion,
    onRejectQuestion,
  } = props;

  const view = usePromptViewState(props);

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

  return (
    <SidebarProvider defaultOpen className="flex h-full min-h-0 w-full">
      <div className="anim-prompt-shell h-full min-h-0 flex">
        <ChannelSidebar
          activeConnectionId={activeConnectionId}
          onSelect={onSelectConnection}
          onSelectProjectSession={view.handleSelectProjectSession}
          onCreateSession={
            view.isOpenCodeBackendAvailable
              ? view.handleNavigateToNewSession
              : undefined
          }
        />
      </div>

      <SidebarInset className="anim-prompt-main flex-1 min-w-0 h-full min-h-0 bg-transparent">
        {/* flex-row wrapper: main content column + TasksSidebar */}
        <div className="flex flex-row flex-1 min-w-0 h-full min-h-0">
          <div className="flex-1 flex flex-col min-w-0 h-full min-h-0">
            {activeConnectionId ? (
              <>
                <ChannelHeader
                  label={sessionChannel?.label ?? activeConnectionId}
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
                  onCopyTranscript={view.handleCopyTranscript}
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
                  {prompt && !activeSession && (
                    <PromptMessage
                      prompt={prompt}
                      secondsLeft={view.secondsLeft}
                    />
                  )}
                  {pendingQuestions[0] && (
                    <QuestionDock
                      question={pendingQuestions[0]}
                      onReply={onReplyQuestion}
                      onReject={onRejectQuestion}
                    />
                  )}
                  {!view.idle && (
                    <ChatHistoryView
                      key={view.providerSessionId ?? activeConnectionId}
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
                      toolAutoExpandExclusions={view.toolAutoExpandExclusions}
                      onNavigateToSession={view.handleNavigateToSession}
                      showThinking={view.showThinking}
                      chatTextSize={view.chatTextSize}
                      fullWidth={view.chatFullWidth}
                      isBusy={view.sessionBusy && view.isOpenCodeSession}
                      channelId={activeConnectionId}
                      searchQuery={view.channelSearchQuery}
                      activeSearchMatchIndex={view.activeSearchMatchIndex}
                      onSearchMatchesChange={view.setChannelSearchMatchCount}
                    />
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

                {view.isOpenCodeSession && !view.idle && (
                  <McpStatusPanel
                    servers={view.mcpServers}
                    isLoading={view.mcpLoading}
                    error={view.mcpError}
                    onRefresh={view.refreshMcpServers}
                    onConnect={view.connectMcpServer}
                    onDisconnect={view.disconnectMcpServer}
                    onAuthenticate={view.authenticateMcpServer}
                    onRemoveAuth={view.removeMcpServerAuth}
                    onOpenSettings={() => view.setMcpSettingsOpen(true)}
                  />
                )}

                {!view.idle && contextUsageSessionId && (
                  <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]/40 px-2.5 py-1">
                    <ContextUsageBar
                      sessionId={contextUsageSessionId}
                      modelContextWindow={
                        view.sessionModelSelection.contextWindow
                      }
                      isBusy={view.sessionBusy && view.isOpenCodeSession}
                    />
                  </div>
                )}

                {!view.idle && (
                  <PromptComposerSection
                    promptActive={Boolean(prompt)}
                    promptBaseDirectory={promptComposerBaseDirectory}
                    promptPlaceholder={promptComposerPlaceholder}
                    queueBaseDirectory={queueComposerBaseDirectory}
                    enabled={Boolean(sessionChannel)}
                    sessionChannelId={sessionChannel?.sessionId}
                    dispatchSessionId={activeConnectionId}
                    providerSessionId={view.providerSessionId}
                    isOpenCodeSession={view.isOpenCodeSession}
                    noReply={view.noReply}
                    commandPaletteOpen={view.commandPaletteOpen}
                    modelId={view.sessionModelSelection.modelId}
                    providerId={view.sessionModelSelection.providerId}
                    variant={view.sessionModelSelection.variant}
                    latestStatus={view.latestStatus}
                    connectionId={activeConnectionId}
                    isBusy={view.sessionBusy && view.isOpenCodeSession}
                    docContextEnabled={docContextEnabled}
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
                    onDismissStatus={onDismissStatus}
                    onToggleDocContext={onToggleDocContext}
                    currentModelOverride={
                      view.sessionModelSelection.currentModelOverride
                    }
                  />
                )}
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

          {activeConnectionId &&
            view.providerSessionId &&
            view.isOpenCodeSession && (
              <TasksSidebar
                todos={view.todos}
                isLoading={view.todosLoading}
                error={view.todosError}
                onRefresh={view.refreshTodos}
                collapsed={view.tasksSidebarCollapsed}
                onToggleCollapsed={view.handleToggleTasksSidebar}
              />
            )}
        </div>
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
