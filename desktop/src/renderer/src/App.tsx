import { useState, useCallback, lazy, Suspense } from 'react';
import PromptView from './pages/PromptView';

const SettingsView = lazy(() => import('./pages/SettingsView'));
const SkillsView = lazy(() => import('./pages/SkillsView'));
const QuickSwitcher = lazy(() => import('./components/QuickSwitcher'));

function LazyViewFallback(): React.ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center text-[var(--color-text-faint)] text-xs">
      Loading&#x2026;
    </div>
  );
}
import StatusBar from './components/StatusBar';
import ShortcutHelpModal from './components/ShortcutHelpModal';
import AllowFolderModal from './components/AllowFolderModal';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';
import { useConnections } from './hooks/useConnections';
import {
  usePermissionToasts,
  dismissPermissionToast,
  type FolderPromptRequest,
} from './hooks/usePermissionToasts';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useSettingsSync } from './store';
import { useProvidersBootstrap } from './store/providers';
import { useSessionGraphSelector } from './store/session-graph';

type Tab = 'prompt' | 'skills' | 'settings';
const TABS: Tab[] = ['prompt', 'skills', 'settings'];

export default function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const { settings } = useSettingsSync();
  const compactMode = settings.compactMode;

  // Eagerly hydrate providers/models at app mount so the new-session form
  // never shows an empty list on cold-start. Also subscribes to main's
  // `providers-info:updated` push events for live refresh.
  useProvidersBootstrap();

  const switchToPrompt = useCallback(() => setActiveTab('prompt'), []);

  const [folderPrompt, setFolderPrompt] = useState<FolderPromptRequest | null>(
    null,
  );

  const {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    activeConn,
    clientInfo,
    handleSubmit,
    handleSubmitForSession,
    handleSelectOption,
    handleSelectOptionForSession,
    handleDismissStatus,
    handleDismissSession,
    handleQueueSessionMessage,
    handleQueueSessionMessageForSession,
    handleInjectWithReply,
    handleInjectWithReplyForSession,
    handleClearChannelMessages,
    handleRemoveSession,
    handleToggleDocContext,
    handleReplyPermission,
    handleReplyQuestion,
    handleRejectQuestion,
    jumpToFirstPendingPrompt,
    ensureChannelHistoryLoaded,
  } = useConnections(switchToPrompt);

  usePermissionToasts({
    connections,
    onReplyPermission: handleReplyPermission,
    onSelectSession: (sessionId) => {
      setActiveConnectionId(sessionId);
      setActiveTab('prompt');
    },
    onRequestFolderPrompt: setFolderPrompt,
  });

  const switchTab = useCallback((tab: 1 | 2 | 3) => {
    setActiveTab(TABS[tab - 1]);
  }, []);

  const {
    showShortcuts,
    openShortcuts,
    closeShortcuts,
    showQuickSwitcher,
    openQuickSwitcher,
    closeQuickSwitcher,
  } = useGlobalShortcuts({
    onSwitchTab: switchTab,
  });

  // "New chat" — clear the active connection so the IdleStateView /
  // new-session form takes over. This mirrors the existing path used when
  // the active session is removed.
  const handleNewChat = useCallback(() => {
    setActiveTab('prompt');
    setActiveConnectionId(null);
  }, [setActiveConnectionId]);

  const handleRefreshSessions = useCallback(() => {
    void window.api.refreshSessionTree();
  }, []);

  const handleNavigate = useCallback(
    (tab: 'prompt' | 'skills' | 'settings') => {
      setActiveTab(tab);
      if (tab === 'prompt') {
        jumpToFirstPendingPrompt();
      }
    },
    [jumpToFirstPendingPrompt],
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveConnectionId(sessionId);
      setActiveTab('prompt');
    },
    [setActiveConnectionId],
  );

  const connectionCount = useSessionGraphSelector(
    (state) => state.connectionCount,
  );

  return (
    <TooltipProvider delay={200}>
      <div
        className="relative flex flex-col h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
        data-compact={compactMode ? 'true' : 'false'}
      >
        <main className="flex-1 overflow-hidden">
          <div className="h-full min-h-0 w-full">
            <PromptView
              connections={connections}
              activeConnectionId={activeConnectionId}
              onSelectConnection={(id) => {
                setActiveConnectionId(id);
                setActiveTab('prompt');
              }}
              prompt={activeConn?.prompt ?? null}
              pendingQuestions={activeConn?.pendingQuestions ?? []}
              activeSession={activeConn?.activeSession ?? null}
              channelMessages={activeConn?.channelMessages ?? []}
              connectionId={activeConn?.connectionId ?? null}
              sessionChannel={activeConn?.sessionChannel ?? null}
              sessionStatuses={activeConn?.sessionStatuses ?? []}
              docContextEnabled={activeConn?.docContextEnabled !== false}
              onSubmit={handleSubmit}
              onSubmitForSession={handleSubmitForSession}
              onSelectOption={handleSelectOption}
              onSelectOptionForSession={handleSelectOptionForSession}
              onDismissStatus={handleDismissStatus}
              onDismissSession={handleDismissSession}
              onQueueSessionMessage={handleQueueSessionMessage}
              onQueueSessionMessageForSession={
                handleQueueSessionMessageForSession
              }
              onInjectWithReply={handleInjectWithReply}
              onInjectWithReplyForSession={handleInjectWithReplyForSession}
              onClearMessages={handleClearChannelMessages}
              onRemoveSession={handleRemoveSession}
              onToggleDocContext={() =>
                activeConnectionId && handleToggleDocContext(activeConnectionId)
              }
              onToggleDocContextForSession={handleToggleDocContext}
              onEnsureSessionHistory={ensureChannelHistoryLoaded}
              onReplyQuestion={handleReplyQuestion}
              onRejectQuestion={handleRejectQuestion}
              activeTab={activeTab}
              onNavigate={handleNavigate}
              onNewChat={handleNewChat}
              onOpenSearch={openQuickSwitcher}
              rightPaneOverride={
                activeTab === 'skills' ? (
                  <Suspense fallback={<LazyViewFallback />}>
                    <SkillsView />
                  </Suspense>
                ) : activeTab === 'settings' ? (
                  <Suspense fallback={<LazyViewFallback />}>
                    <SettingsView />
                  </Suspense>
                ) : undefined
              }
            />
          </div>
        </main>

        <StatusBar
          connectionCount={connectionCount}
          clientInfo={clientInfo}
          onShowShortcuts={openShortcuts}
        />
        <ShortcutHelpModal open={showShortcuts} onClose={closeShortcuts} />
        {showQuickSwitcher && (
          <Suspense fallback={null}>
            <QuickSwitcher
              open={showQuickSwitcher}
              onClose={closeQuickSwitcher}
              onSelectSession={handleSelectSession}
              onNavigate={handleNavigate}
              onRefreshSessions={handleRefreshSessions}
            />
          </Suspense>
        )}
        {folderPrompt && (
          <AllowFolderModal
            filePath={folderPrompt.filePath}
            onSelectFolder={(folderPath) => {
              dismissPermissionToast(folderPrompt.requestId);
              handleReplyPermission(
                folderPrompt.sessionID,
                folderPrompt.requestId,
                'always',
                folderPrompt.directory,
              );
              void window.api.addAllowedReadFolder(folderPath);
              setFolderPrompt(null);
            }}
            onCancel={() => setFolderPrompt(null)}
          />
        )}
        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </TooltipProvider>
  );
}
