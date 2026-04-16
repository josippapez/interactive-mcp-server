import React, { useState, useCallback, useEffect } from 'react';
import type { McpServer } from '../../hooks/useMcpServers';
import {
  getMcpPrimaryAction,
  getMcpStatusIndicatorClass,
  getMcpStatusLabel,
  shouldShowRemoveAuth,
} from './mcp-status-utils';

// ─── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ─── MCP Settings Modal ───────────────────────────────────────────────────────

interface McpSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  servers: McpServer[];
  directory?: string;
  onConnect: (name: string) => Promise<boolean>;
  onDisconnect: (name: string) => Promise<boolean>;
  onAuthenticate: (name: string) => Promise<boolean>;
  onRemoveAuth: (name: string) => Promise<boolean>;
  onRefresh: () => void;
}

export default function McpSettingsModal({
  isOpen,
  onClose,
  servers,
  directory,
  onConnect,
  onDisconnect,
  onAuthenticate,
  onRemoveAuth,
  onRefresh,
}: McpSettingsModalProps): React.ReactElement | null {
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleConnect = useCallback(
    async (name: string) => {
      setActionInProgress(name);
      await onConnect(name);
      setActionInProgress(null);
    },
    [onConnect],
  );

  const handleDisconnect = useCallback(
    async (name: string) => {
      setActionInProgress(name);
      await onDisconnect(name);
      setActionInProgress(null);
    },
    [onDisconnect],
  );

  const handleAuthenticate = useCallback(
    async (name: string) => {
      setActionInProgress(name);
      await onAuthenticate(name);
      setActionInProgress(null);
    },
    [onAuthenticate],
  );

  const handleRemoveAuth = useCallback(
    async (name: string) => {
      setActionInProgress(name);
      await onRemoveAuth(name);
      setActionInProgress(null);
    },
    [onRemoveAuth],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close MCP settings"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[80vh] mx-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <h2 className="text-sm font-semibold">MCP Server Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-surface)] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Directory Context */}
          {directory && (
            <div className="text-xs text-[var(--color-text-faint)] bg-[var(--color-surface-alt)] px-3 py-2 rounded">
              Project: <span className="font-mono">{directory}</span>
            </div>
          )}

          <div className="text-xs text-[var(--color-text-faint)] bg-[var(--color-surface-alt)] px-3 py-2 rounded">
            Configure MCP servers in your workspace's{' '}
            <span className="font-mono">.opencode/opencode.jsonc</span>, then use refresh or connect actions here.
          </div>

          {/* Server List */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-[var(--color-text-faint)]">
              Configured Servers ({servers.length})
            </h3>

             {servers.length === 0 ? (
               <div className="text-center py-6 text-[var(--color-text-faint)] text-xs">
                 No MCP servers configured.
                 <br />
                 Configure them in your project's{' '}
                 <span className="font-mono">.opencode/opencode.jsonc</span>
               </div>
            ) : (
              <div className="space-y-2">
                {servers.map((server) => (
                  <div
                    key={server.name}
                    className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-alt)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${getMcpStatusIndicatorClass(server.status)}`}
                          />
                          <span className="font-medium text-sm truncate">
                            {server.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-faint)]">
                            {server.type}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-faint)]">
                            {getMcpStatusLabel(server.status)}
                          </span>
                        </div>

                        {server.url && (
                          <div className="text-[10px] text-[var(--color-text-faint)] mt-1 font-mono truncate">
                            {server.url}
                          </div>
                        )}

                        {server.command && (
                          <div className="text-[10px] text-[var(--color-text-faint)] mt-1 font-mono truncate">
                            {server.command.join(' ')}
                          </div>
                        )}

                        {server.error && (
                          <div className="text-[10px] text-red-500 mt-1">
                            {server.error}
                          </div>
                        )}

                        {server.status === 'needs_auth' && (
                          <div className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1 rounded mt-2">
                            This server requires authentication before it can connect.
                          </div>
                        )}

                        {server.status === 'needs_client_registration' && (
                          <div className="text-[10px] text-orange-600 bg-orange-500/10 px-2 py-1 rounded mt-2">
                            This server needs OAuth client registration or a configured client ID before authentication can complete.
                          </div>
                        )}

                        {/* Capabilities summary */}
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {server.tools && server.tools.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-agent)]/10 text-[var(--color-agent)]">
                              {server.tools.length} tool
                              {server.tools.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {server.resources && server.resources.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
                              {server.resources.length} resource
                              {server.resources.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {server.prompts && server.prompts.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">
                              {server.prompts.length} prompt
                              {server.prompts.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex-shrink-0">
                        <div className="flex gap-1">
                          {getMcpPrimaryAction(server.status).action === 'disconnect' ? (
                            <button
                              type="button"
                              onClick={() => handleDisconnect(server.name)}
                              disabled={actionInProgress === server.name}
                              className="px-2 py-1 text-[10px] rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                            >
                              {actionInProgress === server.name
                                ? 'Disconnecting...'
                                : 'Disconnect'}
                            </button>
                           ) : getMcpPrimaryAction(server.status).action ===
                                 'authenticate' ||
                               getMcpPrimaryAction(server.status).action ===
                                 'configure_auth' ? (
                             <button
                               type="button"
                               onClick={() => handleAuthenticate(server.name)}
                               disabled={actionInProgress === server.name}
                               className="px-2 py-1 text-[10px] rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 disabled:opacity-50"
                             >
                               {actionInProgress === server.name
                                 ? 'Authenticating...'
                                 : getMcpPrimaryAction(server.status).label}
                             </button>
                           ) : (
                            <button
                              type="button"
                              onClick={() => handleConnect(server.name)}
                              disabled={
                                actionInProgress === server.name ||
                                server.status === 'connecting'
                              }
                              className="px-2 py-1 text-[10px] rounded bg-green-500/10 text-green-500 hover:bg-green-500/20 disabled:opacity-50"
                            >
                              {actionInProgress === server.name
                                ? 'Connecting...'
                                : getMcpPrimaryAction(server.status).label}
                            </button>
                          )}

                          {shouldShowRemoveAuth(server) && (
                            <button
                              type="button"
                              onClick={() => handleRemoveAuth(server.name)}
                              disabled={actionInProgress === server.name}
                              className="px-2 py-1 text-[10px] rounded bg-[var(--color-surface)] text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-50"
                            >
                              Clear auth
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-[var(--color-agent)] text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
