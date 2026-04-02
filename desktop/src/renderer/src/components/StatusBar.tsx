import { useState, useEffect } from 'react';
import { useTheme } from '../ThemeContext';

export default function StatusBar({
  connectionCount,
  clientInfo,
  onShowShortcuts,
}: {
  connectionCount: number;
  clientInfo?: { model?: string; mode?: string };
  onShowShortcuts?: () => void;
}): React.ReactElement {
  const { theme, toggle } = useTheme();
  const [status, setStatus] = useState<{
    running: boolean;
    port: number;
  } | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    window.api.getServerStatus().then(setStatus);
    const interval = setInterval(() => {
      window.api.getServerStatus().then(setStatus);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const [reconnecting, setReconnecting] = useState(false);

  const handleRestart = async (): Promise<void> => {
    setRestarting(true);
    try {
      await window.api.restartMcpServer();
      await window.api.getServerStatus().then(setStatus);
    } finally {
      setRestarting(false);
    }
  };

  const handleForceReconnect = async (): Promise<void> => {
    setReconnecting(true);
    try {
      await window.api.reconnectMcpServer?.();
    } finally {
      setTimeout(() => setReconnecting(false), 1500);
    }
  };

  return (
    <footer className="flex items-center justify-between px-4 py-1 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-[11px] text-[var(--color-text-muted)]">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${status?.running ? 'bg-emerald-500' : 'bg-[var(--color-error)]'}`}
          />
          <span>
            {restarting
              ? 'Restarting…'
              : status?.running
                ? `MCP :${status.port}`
                : 'Server stopped'}
          </span>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed"
            title="Restart MCP server process"
          >
            <span className={restarting ? 'animate-spin inline-block' : ''}>
              ↺
            </span>
          </button>
          <button
            onClick={handleForceReconnect}
            disabled={reconnecting}
            className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed text-yellow-500"
            title="Force reconnect — clear all sessions so clients reinitialize"
          >
            {reconnecting ? '⟳' : '⚡'}
          </button>
        </div>
        {connectionCount > 0 && (
          <>
            <span className="text-[var(--color-text-faint)]">│</span>
            <span>
              {connectionCount} {connectionCount === 1 ? 'client' : 'clients'}
            </span>
          </>
        )}
        {clientInfo?.model && (
          <>
            <span className="text-[var(--color-text-faint)]">│</span>
            <span className="text-[var(--color-agent)]">
              {clientInfo.model}
            </span>
          </>
        )}
        {clientInfo?.mode && (
          <>
            <span className="text-[var(--color-text-faint)]">│</span>
            <span className="text-[var(--color-user)]">{clientInfo.mode}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span>Interactive MCP v1.0.0 — 5 tools</span>
        <span className="text-[var(--color-text-faint)]">│</span>
        <button
          onClick={toggle}
          className="flex items-center gap-1 hover:text-[var(--color-text)] transition-colors cursor-pointer"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
        </button>
        {onShowShortcuts && (
          <>
            <span className="text-[var(--color-text-faint)]">│</span>
            <button
              onClick={onShowShortcuts}
              className="flex items-center gap-1 hover:text-[var(--color-text)] transition-colors cursor-pointer"
              title="Keyboard shortcuts (⌘/)"
            >
              <span>⌨️</span>
              <span>Shortcuts</span>
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
