import { useState, useCallback } from 'react';
import PromptView from './pages/PromptView';
import SettingsView from './pages/SettingsView';
import StatusBar from './components/StatusBar';
import ShortcutHelpModal from './components/ShortcutHelpModal';
import { useConnections } from './hooks/useConnections';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

type Tab = 'prompt' | 'settings';
const TABS: Tab[] = ['prompt', 'settings'];

export default function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('prompt');

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
    handleClearChannelMessages,
    handleRemoveSession,
  } = useConnections(switchToPrompt);

  const switchTab = useCallback((tab: 1 | 2) => {
    setActiveTab(TABS[tab - 1]);
  }, []);

  const { showShortcuts, openShortcuts, closeShortcuts } = useGlobalShortcuts({
    onSwitchTab: switchTab,
  });

  const hasAnyPrompt = Array.from(connections.values()).some(
    (c) => c.hasPendingPrompt,
  );
  const connectionCount = connections.size;

  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="titlebar-drag flex items-center justify-between px-4 pt-8 pb-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-agent)] text-sm">❯</span>
          <h1 className="text-sm font-medium text-[var(--color-text-muted)] tracking-wide">
            Interactive MCP
          </h1>
        </div>
        <nav className="titlebar-no-drag flex gap-0.5">
          <TabButton
            active={activeTab === 'prompt'}
            onClick={() => setActiveTab('prompt')}
            badge={hasAnyPrompt && activeTab !== 'prompt'}
            shortcut="⌘1"
          >
            Prompts
          </TabButton>
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            shortcut="⌘2"
          >
            Settings
          </TabButton>
        </nav>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className={activeTab === 'prompt' ? 'h-full' : 'hidden'}>
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
            onSubmit={handleSubmit}
            onSelectOption={handleSelectOption}
            onDismissStatus={handleDismissStatus}
            onDismissSession={handleDismissSession}
            onQueueSessionMessage={handleQueueSessionMessage}
            onClearMessages={handleClearChannelMessages}
            onRemoveSession={handleRemoveSession}
          />
        </div>
        {activeTab === 'settings' && <SettingsView />}
      </main>

      <StatusBar
        connectionCount={connectionCount}
        clientInfo={clientInfo}
        onShowShortcuts={openShortcuts}
      />
      <ShortcutHelpModal open={showShortcuts} onClose={closeShortcuts} />
    </div>
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
      onClick={onClick}
      className={`relative px-3 py-1 text-xs font-medium transition-colors border-b-2 ${
        active
          ? 'text-[var(--color-agent)] border-[var(--color-agent)]'
          : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)]'
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
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-user)] animate-pulse" />
      )}
    </button>
  );
}
