import { useState, useCallback, useEffect, useRef } from 'react';
import PromptView from './components/PromptView';
import HistoryView from './components/HistoryView';
import SettingsView from './components/SettingsView';
import StatusBar from './components/StatusBar';
import type { ConnectionState } from './types';

type Tab = 'prompt' | 'history' | 'settings';

export default function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const [connections, setConnections] = useState<Map<string, ConnectionState>>(
    new Map(),
  );
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    null,
  );
  const listenersRegistered = useRef(false);

  // Register IPC listeners ONCE at app level so they survive tab switches
  useEffect(() => {
    if (listenersRegistered.current) return;
    listenersRegistered.current = true;

    window.api.onConnectionOpened?.((data) => {
      setConnections((prev) => {
        const next = new Map(prev);
        next.set(data.connectionId, {
          id: data.connectionId,
          name: data.name,
          prompt: null,
          activeSession: null,
          chatHistory: [],
        });
        return next;
      });
      setActiveConnectionId((prev) => prev ?? data.connectionId);
      setActiveTab('prompt');
    });

    window.api.onConnectionClosed?.((data) => {
      let remainingIds: string[] = [];
      setConnections((prev) => {
        const next = new Map(prev);
        next.delete(data.connectionId);
        remainingIds = Array.from(next.keys());
        return next;
      });
      setActiveConnectionId((prev) => {
        if (prev !== data.connectionId) return prev;
        return remainingIds.length > 0 ? remainingIds[0] : null;
      });
    });

    window.api.onPromptRequest((data) => {
      setConnections((prev) => {
        const conn = prev.get(data.connectionId);
        if (!conn) return prev;
        const next = new Map(prev);
        const history = data.sessionId
          ? [
              ...conn.chatHistory,
              {
                type: 'question' as const,
                text: data.message,
                timestamp: new Date(),
              },
            ]
          : conn.chatHistory;
        next.set(data.connectionId, {
          ...conn,
          prompt: data,
          chatHistory: history,
        });
        return next;
      });
      setActiveConnectionId((prev) => prev ?? data.connectionId);
      setActiveTab('prompt');
    });

    window.api.onIntensiveChatStart?.((data) => {
      setConnections((prev) => {
        const conn = prev.get(data.connectionId);
        if (!conn) return prev;
        const next = new Map(prev);
        next.set(data.connectionId, {
          ...conn,
          activeSession: { id: data.sessionId, title: data.title },
          chatHistory: [],
        });
        return next;
      });
      setActiveConnectionId((prev) => prev ?? data.connectionId);
      setActiveTab('prompt');
    });

    window.api.onIntensiveChatStop?.((data) => {
      setConnections((prev) => {
        const conn = prev.get(data.connectionId);
        if (!conn) return prev;
        const next = new Map(prev);
        next.set(data.connectionId, {
          ...conn,
          activeSession: null,
          chatHistory: [],
        });
        return next;
      });
    });
  }, []);

  const activeConn = activeConnectionId
    ? (connections.get(activeConnectionId) ?? null)
    : null;

  const handleSubmit = useCallback(
    (answer: string) => {
      if (!activeConn?.prompt) return;
      const { prompt } = activeConn;

      if (prompt.sessionId) {
        setConnections((prev) => {
          const conn = prev.get(activeConn.id);
          if (!conn) return prev;
          const next = new Map(prev);
          next.set(activeConn.id, {
            ...conn,
            chatHistory: [
              ...conn.chatHistory,
              { type: 'answer', text: answer, timestamp: new Date() },
            ],
            prompt: null,
          });
          return next;
        });
      } else {
        setConnections((prev) => {
          const conn = prev.get(activeConn.id);
          if (!conn) return prev;
          const next = new Map(prev);
          next.set(activeConn.id, { ...conn, prompt: null });
          return next;
        });
      }

      window.api.sendPromptResponse({ id: prompt.id, answer });
    },
    [activeConn],
  );

  const handleSelectOption = useCallback(
    (option: string) => {
      if (!activeConn?.prompt) return;
      const { prompt } = activeConn;

      if (prompt.sessionId) {
        setConnections((prev) => {
          const conn = prev.get(activeConn.id);
          if (!conn) return prev;
          const next = new Map(prev);
          next.set(activeConn.id, {
            ...conn,
            chatHistory: [
              ...conn.chatHistory,
              { type: 'answer', text: option, timestamp: new Date() },
            ],
            prompt: null,
          });
          return next;
        });
      } else {
        setConnections((prev) => {
          const conn = prev.get(activeConn.id);
          if (!conn) return prev;
          const next = new Map(prev);
          next.set(activeConn.id, { ...conn, prompt: null });
          return next;
        });
      }

      window.api.sendPromptResponse({ id: prompt.id, answer: option });
    },
    [activeConn],
  );

  const switchTab = useCallback((tab: Tab) => setActiveTab(tab), []);

  // Badge on Prompts tab when any connection has a pending prompt
  const hasAnyPrompt = Array.from(connections.values()).some(
    (c) => c.prompt !== null,
  );

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Title bar / Nav */}
      <header className="titlebar-drag flex items-center justify-between px-4 pt-8 pb-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-gray-300">
            Interactive MCP
          </h1>
        </div>
        <nav className="titlebar-no-drag flex gap-1">
          <TabButton
            active={activeTab === 'prompt'}
            onClick={() => switchTab('prompt')}
            badge={hasAnyPrompt && activeTab !== 'prompt'}
          >
            Prompts
          </TabButton>
          <TabButton
            active={activeTab === 'history'}
            onClick={() => switchTab('history')}
          >
            History
          </TabButton>
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => switchTab('settings')}
          >
            Settings
          </TabButton>
        </nav>
      </header>

      {/* Connection tab bar */}
      {connections.size > 0 && activeTab === 'prompt' && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800 bg-gray-900/30 overflow-x-auto">
          {Array.from(connections.values()).map((conn) => (
            <button
              key={conn.id}
              onClick={() => setActiveConnectionId(conn.id)}
              className={`relative flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                activeConnectionId === conn.id
                  ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {conn.name}
              {conn.prompt && activeConnectionId !== conn.id && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Main content — PromptView always mounted, others conditional */}
      <main className="flex-1 overflow-hidden">
        <div className={activeTab === 'prompt' ? 'h-full' : 'hidden'}>
          <PromptView
            prompt={activeConn?.prompt ?? null}
            activeSession={activeConn?.activeSession ?? null}
            chatHistory={activeConn?.chatHistory ?? []}
            onSubmit={handleSubmit}
            onSelectOption={handleSelectOption}
          />
        </div>
        {activeTab === 'history' && <HistoryView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-violet-600 text-white'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
      }`}
    >
      {children}
      {badge && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
      )}
    </button>
  );
}
