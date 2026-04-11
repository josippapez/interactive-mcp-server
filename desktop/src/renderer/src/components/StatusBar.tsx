import { useState, useEffect } from 'react';
import { useTheme } from '../ThemeContext';
import { useOpenCodeHealth } from '../hooks/useOpenCodeHealth';

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
  const [appVersion, setAppVersion] = useState<string>('');
  const [isOpenCodeBackend, setIsOpenCodeBackend] = useState(false);

  // Check if OpenCode backend is enabled
  useEffect(() => {
    window.api.getProviderStatus?.().then((providerStatus) => {
      setIsOpenCodeBackend(providerStatus?.backend === 'opencode');
    });
  }, []);

  const {
    status: healthStatus,
    isChecking,
    refresh: refreshHealth,
  } = useOpenCodeHealth(isOpenCodeBackend);

  useEffect(() => {
    window.api.getServerStatus().then(setStatus);
    const interval = setInterval(() => {
      window.api.getServerStatus().then(setStatus);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    window.api.getAppVersion?.().then(setAppVersion);
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
    <footer className="flex items-center justify-between px-4 py-1 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-[11px] text-[var(--color-text-muted)] overflow-hidden flex-nowrap">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden flex-nowrap shrink">
        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
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
        {isOpenCodeBackend && (
          <>
            <span className="text-[var(--color-text-faint)] shrink-0">│</span>
            <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  healthStatus.healthy
                    ? 'bg-emerald-500'
                    : healthStatus.available
                      ? 'bg-yellow-500'
                      : 'bg-[var(--color-error)]'
                }`}
                title={
                  healthStatus.healthy
                    ? `OpenCode healthy${healthStatus.version ? ` (v${healthStatus.version})` : ''}`
                    : healthStatus.available
                      ? 'OpenCode available but unhealthy'
                      : (healthStatus.error ?? 'OpenCode not available')
                }
              />
              <span
                className="shrink-0"
                title={
                  healthStatus.version
                    ? `OpenCode v${healthStatus.version}`
                    : (healthStatus.error ?? 'OpenCode status')
                }
              >
                {isChecking
                  ? 'Checking…'
                  : healthStatus.healthy
                    ? `OpenCode${healthStatus.version ? ` v${healthStatus.version}` : ''}`
                    : healthStatus.available
                      ? 'OpenCode ⚠'
                      : 'OpenCode ✗'}
              </span>
              <button
                onClick={() => void refreshHealth()}
                disabled={isChecking}
                className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed shrink-0"
                title="Refresh OpenCode health status"
              >
                <span className={isChecking ? 'animate-spin inline-block' : ''}>
                  ↺
                </span>
              </button>
            </div>
          </>
        )}
        {connectionCount > 0 && (
          <>
            <span className="text-[var(--color-text-faint)] shrink-0">│</span>
            <span>
              {connectionCount} {connectionCount === 1 ? 'client' : 'clients'}
            </span>
          </>
        )}
        {clientInfo?.model && (
          <>
            <span className="text-[var(--color-text-faint)] shrink-0">│</span>
            <span className="text-[var(--color-agent)]">
              {clientInfo.model}
            </span>
          </>
        )}
        {clientInfo?.mode && (
          <>
            <span className="text-[var(--color-text-faint)] shrink-0">│</span>
            <span className="text-[var(--color-user)]">{clientInfo.mode}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 flex-nowrap">
        {appVersion && (
          <span className="text-[var(--color-text-faint)]">
            Interactive MCP v{appVersion}
          </span>
        )}
        <span className="text-[var(--color-text-faint)]">│</span>
        <button
          onClick={toggle}
          className="flex items-center gap-1 hover:text-[var(--color-text)] transition-colors cursor-pointer"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span>{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
        {onShowShortcuts && (
          <>
            <span className="text-[var(--color-text-faint)] shrink-0">│</span>
            <button
              onClick={onShowShortcuts}
              className="flex items-center gap-1 hover:text-[var(--color-text)] transition-colors cursor-pointer"
              title="Keyboard shortcuts (⌘/)"
            >
              <span>⌨</span>
              <span>Shortcuts</span>
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
