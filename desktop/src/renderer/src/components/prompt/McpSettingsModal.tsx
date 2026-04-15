import React, { useState, useCallback, useEffect } from 'react';
import type { McpServer } from '../../hooks/useMcpServers';

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

function PlusIcon(): React.ReactElement {
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
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ─── Add MCP Form ─────────────────────────────────────────────────────────────

interface AddMcpFormProps {
  onAdd: (
    name: string,
    config: {
      type: 'local' | 'remote';
      url?: string;
      command?: string[];
      environment?: Record<string, string>;
    },
  ) => Promise<boolean>;
  onCancel: () => void;
}

function AddMcpForm({ onAdd, onCancel }: AddMcpFormProps): React.ReactElement {
  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'remote'>('remote');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!name.trim()) {
        setError('Name is required');
        return;
      }

      if (type === 'remote' && !url.trim()) {
        setError('URL is required for remote MCP');
        return;
      }

      if (type === 'local' && !command.trim()) {
        setError('Command is required for local MCP');
        return;
      }

      setIsSubmitting(true);

      const config: {
        type: 'local' | 'remote';
        url?: string;
        command?: string[];
      } = { type };

      if (type === 'remote') {
        config.url = url.trim();
      } else {
        // Split command by spaces, respecting quotes
        config.command = command
          .trim()
          .match(/(?:[^\s"]+|"[^"]*")+/g)
          ?.map((s) => s.replace(/^"|"$/g, ''));
      }

      const success = await onAdd(name.trim(), config);

      setIsSubmitting(false);

      if (!success) {
        setError('Failed to add MCP server');
      }
    },
    [name, type, url, command, onAdd],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Name */}
      <div>
        <label className="block text-xs text-[var(--color-text-faint)] mb-1">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-mcp-server"
          className="w-full px-2 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:border-[var(--color-agent)] focus:outline-none"
        />
      </div>

      {/* Type */}
      <div>
        <label className="block text-xs text-[var(--color-text-faint)] mb-1">
          Type
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType('remote')}
            className={`flex-1 px-2 py-1.5 text-xs rounded border ${
              type === 'remote'
                ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-faint)] hover:border-[var(--color-text-faint)]'
            }`}
          >
            Remote (HTTP)
          </button>
          <button
            type="button"
            onClick={() => setType('local')}
            className={`flex-1 px-2 py-1.5 text-xs rounded border ${
              type === 'local'
                ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-faint)] hover:border-[var(--color-text-faint)]'
            }`}
          >
            Local (Subprocess)
          </button>
        </div>
      </div>

      {/* URL (for remote) */}
      {type === 'remote' && (
        <div>
          <label className="block text-xs text-[var(--color-text-faint)] mb-1">
            URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000/mcp"
            className="w-full px-2 py-1.5 text-sm font-mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:border-[var(--color-agent)] focus:outline-none"
          />
        </div>
      )}

      {/* Command (for local) */}
      {type === 'local' && (
        <div>
          <label className="block text-xs text-[var(--color-text-faint)] mb-1">
            Command
          </label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @my-org/my-mcp"
            className="w-full px-2 py-1.5 text-sm font-mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:border-[var(--color-agent)] focus:outline-none"
          />
          <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
            Enter the command to run the MCP server (space-separated arguments)
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 px-2 py-1.5 rounded">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-agent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Adding...' : 'Add MCP'}
        </button>
      </div>
    </form>
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
  onRefresh: () => void;
}

export default function McpSettingsModal({
  isOpen,
  onClose,
  servers,
  directory,
  onConnect,
  onDisconnect,
  onRefresh,
}: McpSettingsModalProps): React.ReactElement | null {
  const [showAddForm, setShowAddForm] = useState(false);
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

  const handleAddMcp = useCallback(
    async (
      name: string,
      config: {
        type: 'local' | 'remote';
        url?: string;
        command?: string[];
      },
    ): Promise<boolean> => {
      try {
        const result = await window.api.registerMcp(name, config, directory);
        if (result.ok) {
          setShowAddForm(false);
          onRefresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [directory, onRefresh],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[80vh] mx-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <h2 className="text-sm font-semibold">MCP Server Settings</h2>
          <button
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

          {/* Add MCP Form */}
          {showAddForm ? (
            <div className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-alt)]">
              <h3 className="text-xs font-medium mb-3">Add New MCP Server</h3>
              <AddMcpForm
                onAdd={handleAddMcp}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded border border-dashed border-[var(--color-border)] text-[var(--color-text-faint)] hover:border-[var(--color-agent)] hover:text-[var(--color-agent)] transition-colors"
            >
              <PlusIcon />
              Add MCP Server
            </button>
          )}

          {/* Server List */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-[var(--color-text-faint)]">
              Configured Servers ({servers.length})
            </h3>

            {servers.length === 0 ? (
              <div className="text-center py-6 text-[var(--color-text-faint)] text-xs">
                No MCP servers configured.
                <br />
                Add one above or configure them in your project's{' '}
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
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              server.status === 'connected'
                                ? 'bg-green-500'
                                : server.status === 'error'
                                  ? 'bg-red-500'
                                  : server.status === 'connecting'
                                    ? 'bg-yellow-500 animate-pulse'
                                    : 'bg-gray-400'
                            }`}
                          />
                          <span className="font-medium text-sm truncate">
                            {server.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-faint)]">
                            {server.type}
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
                        {server.status === 'connected' ? (
                          <button
                            onClick={() => handleDisconnect(server.name)}
                            disabled={actionInProgress === server.name}
                            className="px-2 py-1 text-[10px] rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {actionInProgress === server.name
                              ? 'Disconnecting...'
                              : 'Disconnect'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleConnect(server.name)}
                            disabled={actionInProgress === server.name}
                            className="px-2 py-1 text-[10px] rounded bg-green-500/10 text-green-500 hover:bg-green-500/20 disabled:opacity-50"
                          >
                            {actionInProgress === server.name
                              ? 'Connecting...'
                              : 'Connect'}
                          </button>
                        )}
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
