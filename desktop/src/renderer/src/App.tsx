import { useState, useCallback, useRef } from 'react';
import PromptView from './pages/PromptView';
import SettingsView from './pages/SettingsView';
import SkillsView from './pages/SkillsView';
import StatusBar from './components/StatusBar';
import ShortcutHelpModal from './components/ShortcutHelpModal';
import QuickSwitcher from './components/QuickSwitcher';
import PermissionToast from './components/PermissionToast';
import { TooltipProvider } from './components/ui/tooltip';
import { useConnections } from './hooks/useConnections';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useSettingsSync } from './store';
import { useSessionGraphSelector } from './store/session-graph';

type Tab = 'prompt' | 'skills' | 'settings';
const TABS: Tab[] = ['prompt', 'skills', 'settings'];

export default function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const { settings } = useSettingsSync();
  const compactMode = settings.compactMode;

  // Ref for triggering skill creation from QuickSwitcher
  const skillsViewRef = useRef<{
    createNew: (type: 'skill' | 'instruction') => void;
  } | null>(null);

  const switchToPrompt = useCallback(() => setActiveTab('prompt'), []);

  const {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    activeConn,
    clientInfo,
    handleSubmit,
    handleSelectOption,
    handleDismissStatus,
    handleDismissSession,
    handleQueueSessionMessage,
    handleInjectWithReply,
    handleClearChannelMessages,
    handleRemoveSession,
    handleToggleDocContext,
    handleReplyPermission,
    jumpToFirstPendingPrompt,
  } = useConnections(switchToPrompt);

  const handlePromptTabClick = useCallback(() => {
    setActiveTab('prompt');
    jumpToFirstPendingPrompt();
  }, [jumpToFirstPendingPrompt]);

  const switchTab = useCallback((tab: 1 | 2 | 3) => {
    setActiveTab(TABS[tab - 1]);
  }, []);

  const {
    showShortcuts,
    openShortcuts,
    closeShortcuts,
    showQuickSwitcher,
    closeQuickSwitcher,
  } = useGlobalShortcuts({
    onSwitchTab: switchTab,
  });

  const handleRefreshSessions = useCallback(() => {
    void window.api.refreshSessionTree();
  }, []);

  const handleCreateSkill = useCallback(() => {
    skillsViewRef.current?.createNew('skill');
  }, []);

  const handleCreateInstruction = useCallback(() => {
    skillsViewRef.current?.createNew('instruction');
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
    },
    [setActiveConnectionId],
  );

  const hasAnyPrompt = useSessionGraphSelector(
    (state) => state.hasPendingPrompt,
  );
  // Show the badge whenever there is a pending prompt on a channel that is NOT
  // currently visible — i.e. either we're on a different tab, or we're on the
  // prompt tab but viewing a channel without a pending prompt.
  const activeChannelHasPrompt = Boolean(activeConn?.hasPendingPrompt);
  const showPromptBadge = hasAnyPrompt && !activeChannelHasPrompt;
  const connectionCount = useSessionGraphSelector(
    (state) => state.connectionCount,
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex flex-col h-screen bg-[var(--color-bg)] text-[var(--color-text)]"
        data-compact={compactMode ? 'true' : 'false'}
      >
        <header
          data-titlebar
          className="titlebar-drag flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]/92 pb-3 pl-24 pr-5 pt-4 backdrop-blur-md"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-agent)]/10 text-[var(--color-agent)] shadow-sm">
              <span className="text-base leading-none">&#x276F;</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-text)]">
                Eden
              </h1>
              <p className="truncate text-[11px] text-[var(--color-text-faint)]">
                Interactive MCP Desktop
              </p>
            </div>
          </div>
          <nav className="titlebar-no-drag flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)]/85 p-1 shadow-sm">
            <TabButton
              active={activeTab === 'prompt'}
              onClick={handlePromptTabClick}
              badge={showPromptBadge}
              shortcut="&#x2318;1"
            >
              Prompts
            </TabButton>
            <TabButton
              active={activeTab === 'skills'}
              onClick={() => setActiveTab('skills')}
              shortcut="&#x2318;2"
            >
              Skills
            </TabButton>
            <TabButton
              active={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
              shortcut="&#x2318;3"
            >
              Settings
            </TabButton>
          </nav>
        </header>

        <main className="flex-1 overflow-hidden">
          <div
            className={
              activeTab === 'prompt' ? 'h-full min-h-0 w-full' : 'hidden'
            }
          >
            <PromptView
              connections={connections}
              activeConnectionId={activeConnectionId}
              onSelectConnection={setActiveConnectionId}
              prompt={activeConn?.prompt ?? null}
              activeSession={activeConn?.activeSession ?? null}
              channelMessages={activeConn?.channelMessages ?? []}
              connectionId={activeConn?.connectionId ?? null}
              sessionChannel={activeConn?.sessionChannel ?? null}
              sessionStatuses={activeConn?.sessionStatuses ?? []}
              docContextEnabled={activeConn?.docContextEnabled !== false}
              onSubmit={handleSubmit}
              onSelectOption={handleSelectOption}
              onDismissStatus={handleDismissStatus}
              onDismissSession={handleDismissSession}
              onQueueSessionMessage={handleQueueSessionMessage}
              onInjectWithReply={handleInjectWithReply}
              onClearMessages={handleClearChannelMessages}
              onRemoveSession={handleRemoveSession}
              onToggleDocContext={() =>
                activeConnectionId && handleToggleDocContext(activeConnectionId)
              }
            />
          </div>
          {activeTab === 'skills' && <SkillsView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>

        <StatusBar
          connectionCount={connectionCount}
          clientInfo={clientInfo}
          onShowShortcuts={openShortcuts}
        />
        <ShortcutHelpModal open={showShortcuts} onClose={closeShortcuts} />
        <QuickSwitcher
          open={showQuickSwitcher}
          onClose={closeQuickSwitcher}
          onSelectSession={handleSelectSession}
          onNavigate={handleNavigate}
          onRefreshSessions={handleRefreshSessions}
          onCreateSkill={handleCreateSkill}
          onCreateInstruction={handleCreateInstruction}
        />
        <PermissionToast
          connections={connections}
          onReplyPermission={handleReplyPermission}
          onSelectSession={(sessionId) => {
            setActiveConnectionId(sessionId);
            setActiveTab('prompt');
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge,
  shortcut,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: boolean;
  shortcut?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all ${
        active
          ? 'bg-[var(--color-agent)]/12 text-[var(--color-agent)] shadow-sm ring-1 ring-[var(--color-agent)]/15'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/70 hover:text-[var(--color-text)]'
      }`}
    >
      <span className="flex items-center gap-1">
        {children}
        {shortcut && (
          <span className="text-[10px] text-[var(--color-text-faint)]">
            {shortcut}
          </span>
        )}
      </span>
      {badge && (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--color-user)] animate-pulse" />
      )}
    </button>
  );
}
