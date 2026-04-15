import React, { useState, useCallback, memo } from 'react';
import type { McpServer } from '../../hooks/useMcpServers';

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlugIcon(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function RefreshIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function SettingsIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ToolIcon(): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  status,
}: {
  status: McpServer['status'];
}): React.ReactElement {
  const colors: Record<McpServer['status'], string> = {
    connected: 'bg-green-500',
    disconnected: 'bg-gray-400',
    connecting: 'bg-yellow-500 animate-pulse',
    error: 'bg-red-500',
  };

  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[status]}`}
      title={status}
    />
  );
}

// ─── MCP Server Item ──────────────────────────────────────────────────────────

interface McpServerItemProps {
  server: McpServer;
  onConnect: (name: string) => void;
  onDisconnect: (name: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const McpServerItem = memo(function McpServerItem({
  server,
  onConnect,
  onDisconnect,
  isExpanded,
  onToggleExpand,
}: McpServerItemProps): React.ReactElement {
  const toolCount = server.tools?.length ?? 0;
  const resourceCount = server.resources?.length ?? 0;
  const promptCount = server.prompts?.length ?? 0;
  const hasCapabilities = toolCount > 0 || resourceCount > 0 || promptCount > 0;

  return (
    <div className="border border-[var(--color-border)] rounded-md overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-surface-alt)] cursor-pointer hover:bg-[var(--color-surface-alt)]/80"
        onClick={onToggleExpand}
      >
        <StatusBadge status={server.status} />
        <span className="font-medium text-xs flex-1 truncate">{server.name}</span>
        <span className="text-[10px] text-[var(--color-text-faint)] px-1 py-0.5 rounded bg-[var(--color-surface)]">
          {server.type}
        </span>
        {hasCapabilities && (
          <span className="text-[10px] text-[var(--color-text-faint)] flex items-center gap-1">
            <ToolIcon />
            {toolCount}
          </span>
        )}
        <ChevronIcon open={isExpanded} />
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-2 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] space-y-2">
          {/* Status and Actions */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-faint)]">
              Status: <span className="capitalize">{server.status}</span>
              {server.error && (
                <span className="text-red-500 ml-1">({server.error})</span>
              )}
            </span>
            <div className="flex gap-1">
              {server.status === 'connected' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDisconnect(server.name);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnect(server.name);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-500 hover:bg-green-500/20"
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {/* Connection Info */}
          {server.url && (
            <div className="text-[10px] text-[var(--color-text-faint)]">
              URL: <span className="font-mono">{server.url}</span>
            </div>
          )}
          {server.command && (
            <div className="text-[10px] text-[var(--color-text-faint)]">
              Command: <span className="font-mono">{server.command.join(' ')}</span>
            </div>
          )}

          {/* Tools */}
          {server.tools && server.tools.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-[var(--color-text-faint)]">
                Tools ({server.tools.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {server.tools.slice(0, 10).map((tool) => (
                  <span
                    key={tool.name}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-agent)]/10 text-[var(--color-agent)]"
                    title={tool.description}
                  >
                    {tool.name}
                  </span>
                ))}
                {server.tools.length > 10 && (
                  <span className="text-[9px] px-1.5 py-0.5 text-[var(--color-text-faint)]">
                    +{server.tools.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Resources */}
          {server.resources && server.resources.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-[var(--color-text-faint)]">
                Resources ({server.resources.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {server.resources.slice(0, 5).map((resource) => (
                  <span
                    key={resource.uri}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500"
                    title={resource.description}
                  >
                    {resource.name}
                  </span>
                ))}
                {server.resources.length > 5 && (
                  <span className="text-[9px] px-1.5 py-0.5 text-[var(--color-text-faint)]">
                    +{server.resources.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Prompts */}
          {server.prompts && server.prompts.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-[var(--color-text-faint)]">
                Prompts ({server.prompts.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {server.prompts.slice(0, 5).map((prompt) => (
                  <span
                    key={prompt.name}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500"
                    title={prompt.description}
                  >
                    {prompt.name}
                  </span>
                ))}
                {server.prompts.length > 5 && (
                  <span className="text-[9px] px-1.5 py-0.5 text-[var(--color-text-faint)]">
                    +{server.prompts.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── MCP Status Panel ─────────────────────────────────────────────────────────

interface McpStatusPanelProps {
  servers: McpServer[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onConnect: (name: string) => void;
  onDisconnect: (name: string) => void;
  onOpenSettings?: () => void;
}

export default function McpStatusPanel({
  servers,
  isLoading,
  error,
  onRefresh,
  onConnect,
  onDisconnect,
  onOpenSettings,
}: McpStatusPanelProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  const connectedCount = servers.filter((s) => s.status === 'connected').length;
  const totalCount = servers.length;

  const toggleServerExpand = useCallback((name: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-alt)] hover:bg-[var(--color-surface-alt)]/80 transition-colors"
      >
        <PlugIcon />
        <span className="text-xs font-medium flex-1 text-left">MCP Servers</span>
        <span className="text-[10px] text-[var(--color-text-faint)]">
          {connectedCount}/{totalCount} connected
        </span>
        {isLoading && (
          <span className="w-3 h-3 border-2 border-[var(--color-agent)] border-t-transparent rounded-full animate-spin" />
        )}
        <ChevronIcon open={isExpanded} />
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-2 border-t border-[var(--color-border)] space-y-2">
          {/* Actions */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-faint)]">
              {totalCount === 0
                ? 'No MCP servers configured'
                : `${totalCount} server${totalCount !== 1 ? 's' : ''}`}
            </span>
            <div className="flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh();
                }}
                disabled={isLoading}
                className="p-1 rounded hover:bg-[var(--color-surface-alt)] text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-50"
                title="Refresh"
              >
                <RefreshIcon />
              </button>
              {onOpenSettings && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSettings();
                  }}
                  className="p-1 rounded hover:bg-[var(--color-surface-alt)] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                  title="MCP Settings"
                >
                  <SettingsIcon />
                </button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-[10px] text-red-500 bg-red-500/10 px-2 py-1 rounded">
              {error}
            </div>
          )}

          {/* Server List */}
          {servers.length > 0 && (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {servers.map((server) => (
                <McpServerItem
                  key={server.name}
                  server={server}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  isExpanded={expandedServers.has(server.name)}
                  onToggleExpand={() => toggleServerExpand(server.name)}
                />
              ))}
            </div>
          )}

          {/* Empty State */}
          {servers.length === 0 && !isLoading && !error && (
            <div className="text-center py-4 text-[var(--color-text-faint)] text-xs">
              No MCP servers found.
              <br />
              Configure MCPs in your project's{' '}
              <span className="font-mono">.opencode/opencode.jsonc</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
