import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  autoStartOpenCode: boolean;
  autoSyncOpencode: boolean;
  docContextDebug: boolean;
  agentBackend: 'standalone' | 'opencode' | 'claude_sdk';
  autoRegisterSubagents: boolean;
  extraMcpServers: string;
  compactMode: boolean;
  toolAutoExpandExclusions: string[];
  discoveredTools: string[];
};

/**
 * Predefined list of common MCP tool names.
 * Must match the list in main/settings.ts.
 */
const PREDEFINED_TOOLS = [
  'Edit',
  'Read',
  'Write',
  'Bash',
  'Grep',
  'Glob',
  'WebFetch',
  'TodoWrite',
  'Task',
  'question',
  'skill',
] as const;

type SettingsSection =
  | 'server'
  | 'provider'
  | 'sessions'
  | 'documentation'
  | 'preferences'
  | 'advanced';

const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: 'server', label: 'Server', icon: '⚙' },
  { id: 'provider', label: 'Provider', icon: '⬡' },
  { id: 'sessions', label: 'Sessions', icon: '◎' },
  { id: 'documentation', label: 'Documentation', icon: '📄' },
  { id: 'preferences', label: 'Preferences', icon: '🔔' },
  { id: 'advanced', label: 'Advanced', icon: '⚡' },
];

/** Reusable toggle switch component */
function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 pr-4">
        <label
          htmlFor={id}
          className="text-sm text-[var(--color-text-muted)] cursor-pointer"
        >
          {label}
        </label>
        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
          {description}
        </p>
      </div>
      <button
        id={id}
        type="button"
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-[var(--color-agent)]' : 'bg-[var(--color-border)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Tool exclusions section for managing which tools to exclude from auto-expand.
 */
function ToolExclusionsSection({
  settings,
  onUpdateExclusions,
}: {
  settings: AppSettings;
  onUpdateExclusions: (exclusions: string[]) => void;
}): React.ReactElement {
  // Combine predefined tools with discovered tools, removing duplicates
  const allTools = useMemo(() => {
    const combined = new Set([
      ...PREDEFINED_TOOLS,
      ...(settings.discoveredTools ?? []),
    ]);
    return Array.from(combined).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }, [settings.discoveredTools]);

  const exclusions = settings.toolAutoExpandExclusions ?? [];

  const toggleTool = useCallback(
    (toolName: string) => {
      const isExcluded = exclusions.includes(toolName);
      if (isExcluded) {
        onUpdateExclusions(exclusions.filter((t) => t !== toolName));
      } else {
        onUpdateExclusions([...exclusions, toolName]);
      }
    },
    [exclusions, onUpdateExclusions],
  );

  const selectAll = useCallback(() => {
    onUpdateExclusions([...allTools]);
  }, [allTools, onUpdateExclusions]);

  const selectNone = useCallback(() => {
    onUpdateExclusions([]);
  }, [onUpdateExclusions]);

  return (
    <div className="py-3 border-t border-[var(--color-border)] mt-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm text-[var(--color-text-muted)]">
            Tool Auto-Expand Exclusions
          </span>
          <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
            Tools checked here will stay collapsed even when "Expand All Tools"
            is enabled
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectNone}
            className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)] transition-colors"
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)] transition-colors"
          >
            Exclude All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-48 overflow-y-auto p-2 bg-[var(--color-surface)] rounded border border-[var(--color-border)]">
        {allTools.map((toolName) => {
          const isExcluded = exclusions.includes(toolName);
          const isPredefined = (PREDEFINED_TOOLS as readonly string[]).includes(
            toolName,
          );
          return (
            <label
              key={toolName}
              className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--color-border)]/30 cursor-pointer text-xs"
            >
              <input
                type="checkbox"
                checked={isExcluded}
                onChange={() => toggleTool(toolName)}
                className="w-3 h-3 rounded accent-[var(--color-agent)]"
              />
              <span
                className={
                  isExcluded
                    ? 'text-[var(--color-text-faint)] line-through'
                    : 'text-[var(--color-text-muted)]'
                }
              >
                {toolName}
              </span>
              {!isPredefined && (
                <span
                  className="text-[8px] px-1 py-0.5 rounded bg-[var(--color-agent)]/10 text-[var(--color-agent)]"
                  title="Discovered from conversation"
                >
                  new
                </span>
              )}
            </label>
          );
        })}
        {allTools.length === 0 && (
          <span className="col-span-full text-center text-[var(--color-text-faint)] text-xs py-2">
            No tools discovered yet
          </span>
        )}
      </div>

      {exclusions.length > 0 && (
        <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
          {exclusions.length} tool{exclusions.length !== 1 ? 's' : ''} excluded
          from auto-expand
        </p>
      )}
    </div>
  );
}

/** Reusable number input component */
function NumberInput({
  id,
  value,
  onChange,
  label,
  description,
  min,
  max,
  isValid,
  errorMessage,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  description: string;
  min?: number;
  max?: number;
  isValid: boolean;
  errorMessage?: string;
}): React.ReactElement {
  return (
    <div className="py-3">
      <label
        htmlFor={id}
        className="block text-sm text-[var(--color-text-muted)] mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        aria-invalid={!isValid}
        aria-describedby={`${id}-help`}
        className="w-32 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
      />
      <p
        id={`${id}-help`}
        className="text-xs text-[var(--color-text-faint)] mt-1"
      >
        {description}
      </p>
      {!isValid && errorMessage && (
        <p className="text-xs text-[var(--color-error)] mt-1">{errorMessage}</p>
      )}
    </div>
  );
}

export default function SettingsView(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(
    null,
  );
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [portInput, setPortInput] = useState('');
  const [timeoutInput, setTimeoutInput] = useState('');
  const [openCodePortInput, setOpenCodePortInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dbResetStatus, setDbResetStatus] = useState<string | null>(null);
  const [providerStatusText, setProviderStatusText] = useState<string | null>(
    null,
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>('server');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setInitialSettings(s);
      setPortInput(String(s.port));
      setTimeoutInput(String(s.promptTimeoutSeconds));
      setOpenCodePortInput(String(s.openCodePort));
    });
  }, []);

  useEffect(() => {
    if (!settings) return;
    let isActive = true;

    window.api
      .getProviderStatus()
      .then((status) => {
        if (!isActive) return;
        if (status.backend === 'claude_sdk' && status.runtime) {
          setProviderStatusText(status.runtime.message);
          return;
        }
        setProviderStatusText(null);
      })
      .catch(() => {
        if (!isActive) return;
        setProviderStatusText(null);
      });

    return () => {
      isActive = false;
    };
  }, [settings]);

  const port = parseInt(portInput, 10);
  const timeout = parseInt(timeoutInput, 10);
  const openCodePort = parseInt(openCodePortInput, 10);
  const isPortValid = !isNaN(port) && port >= 1024 && port <= 65535;
  const isTimeoutValid = !isNaN(timeout) && timeout >= 0;
  const isOpenCodePortValid =
    !isNaN(openCodePort) && openCodePort >= 1024 && openCodePort <= 65535;
  const isFormValid = isPortValid && isTimeoutValid && isOpenCodePortValid;
  const isDirty =
    initialSettings !== null &&
    settings !== null &&
    (portInput !== String(initialSettings.port) ||
      timeoutInput !== String(initialSettings.promptTimeoutSeconds) ||
      openCodePortInput !== String(initialSettings.openCodePort) ||
      settings.soundEnabled !== initialSettings.soundEnabled ||
      settings.launchAtLogin !== initialSettings.launchAtLogin ||
      settings.autoRestoreSessions !== initialSettings.autoRestoreSessions ||
      settings.docIndexingEnabled !== initialSettings.docIndexingEnabled ||
      settings.autoStartOpenCode !== initialSettings.autoStartOpenCode ||
      settings.autoSyncOpencode !== initialSettings.autoSyncOpencode ||
      settings.docContextDebug !== initialSettings.docContextDebug ||
      settings.agentBackend !== initialSettings.agentBackend ||
      settings.autoRegisterSubagents !==
        initialSettings.autoRegisterSubagents ||
      settings.extraMcpServers !== initialSettings.extraMcpServers ||
      settings.compactMode !== initialSettings.compactMode ||
      JSON.stringify(settings.toolAutoExpandExclusions ?? []) !==
        JSON.stringify(initialSettings.toolAutoExpandExclusions ?? []));

  const nextSettings =
    settings !== null && isFormValid
      ? {
          ...settings,
          port,
          promptTimeoutSeconds: timeout,
          openCodePort,
        }
      : null;

  useEffect(() => {
    if (!nextSettings) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      return;
    }

    if (!isDirty) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (saveState === 'saved') {
        saveStatusTimeoutRef.current = setTimeout(
          () => setSaveState('idle'),
          1500,
        );
      }
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      setSaveState('saving');

      void window.api
        .saveSettings(nextSettings)
        .then(() => {
          setSettings(nextSettings);
          setInitialSettings(nextSettings);
          setSaveState('saved');

          if (saveStatusTimeoutRef.current) {
            clearTimeout(saveStatusTimeoutRef.current);
          }
          saveStatusTimeoutRef.current = setTimeout(
            () => setSaveState('idle'),
            1500,
          );
        })
        .catch(() => setSaveState('error'));
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [isDirty, isFormValid, nextSettings, saveState]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
    };
  }, []);

  if (!settings || !initialSettings) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-faint)] text-sm">
        Loading settings…
      </div>
    );
  }

  const renderServerSection = (): React.ReactElement => (
    <div className="space-y-2">
      <NumberInput
        id="settings-port"
        value={portInput}
        onChange={setPortInput}
        label="MCP Server Port"
        description="Range: 1024–65535. Requires restart if changed."
        min={1024}
        max={65535}
        isValid={isPortValid}
        errorMessage="Enter a valid port between 1024 and 65535."
      />

      <NumberInput
        id="settings-opencode-port"
        value={openCodePortInput}
        onChange={setOpenCodePortInput}
        label="Provider API Port"
        description="Port used to inject context into provider sessions."
        min={1024}
        max={65535}
        isValid={isOpenCodePortValid}
        errorMessage="Enter a valid port between 1024 and 65535."
      />

      <NumberInput
        id="settings-timeout"
        value={timeoutInput}
        onChange={setTimeoutInput}
        label="Prompt Timeout (seconds)"
        description="How long to wait for a response before the tool call times out. 0 = no timeout."
        min={0}
        isValid={isTimeoutValid}
        errorMessage="Timeout must be 0 or greater."
      />
    </div>
  );

  const renderProviderSection = (): React.ReactElement => (
    <div className="space-y-2">
      {/* Agent backend */}
      <div className="py-3">
        <label
          htmlFor="settings-agent-backend"
          className="block text-sm text-[var(--color-text-muted)] mb-1"
        >
          Agent Backend
        </label>
        <select
          id="settings-agent-backend"
          value={settings.agentBackend}
          onChange={(e) =>
            setSettings((s) =>
              s
                ? {
                    ...s,
                    agentBackend: e.target.value as AppSettings['agentBackend'],
                  }
                : s,
            )
          }
          className="w-56 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
        >
          <option value="standalone">Standalone (no provider)</option>
          <option value="opencode">OpenCode (provider)</option>
          <option value="claude_sdk">Claude SDK (planned)</option>
        </select>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          Controls provider-specific session hierarchy and context injection
          behavior. Standalone uses plain Interactive MCP mode.
        </p>
        {providerStatusText && (
          <p className="text-xs text-[var(--color-warning,orange)] mt-1">
            {providerStatusText}
          </p>
        )}
      </div>

      <Toggle
        id="settings-auto-start"
        checked={settings.autoStartOpenCode}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, autoStartOpenCode: !s.autoStartOpenCode } : s,
          )
        }
        label="Auto-start provider server"
        description="Automatically run opencode serve on the configured port when the app starts"
      />

      <Toggle
        id="settings-auto-sync"
        checked={settings.autoSyncOpencode}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, autoSyncOpencode: !s.autoSyncOpencode } : s,
          )
        }
        label="Auto-sync provider config"
        description="Write a remote MCP entry into opencode.json on startup (fallback)"
      />

      {/* Manual sync button */}
      <div className="py-3 border-t border-[var(--color-border)] mt-4">
        <p className="text-xs text-[var(--color-text-faint)] mb-2">
          Registration is not automatic. After changing settings or restarting
          OpenCode, click this button to register the desktop app as an MCP
          server and update opencode.json with the correct timeout. Then restart
          OpenCode for the new config to take effect.
        </p>
        <button
          type="button"
          onClick={async () => {
            setSyncStatus(null);
            try {
              const result = await window.api.syncOpencodeConfig();
              setSyncStatus(result);
            } catch {
              setSyncStatus('error');
            }
            setTimeout(() => setSyncStatus(null), 4000);
          }}
          className="px-3 py-1.5 rounded-sm border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          Register provider config
        </button>
        {syncStatus && (
          <div className="text-xs mt-1 space-y-0.5" aria-live="polite">
            {syncStatus.includes('register=registered') && (
              <p className="text-[var(--color-agent)]">
                Provider registration succeeded
              </p>
            )}
            {syncStatus.includes('register=unreachable') && (
              <p className="text-[var(--color-warning,orange)]">
                Provider not reachable
              </p>
            )}
            {syncStatus.includes('config=updated') && (
              <p className="text-[var(--color-agent)]">Config file updated</p>
            )}
            {syncStatus.includes('config=already-current') && (
              <p className="text-[var(--color-agent)]">
                Config already up to date
              </p>
            )}
            {syncStatus.includes('opencode-config-missing') && (
              <p className="text-[var(--color-error)]">
                No opencode.json found — run OpenCode once to create it.
              </p>
            )}
            {!syncStatus.includes('register=') &&
              !syncStatus.includes('config=') &&
              !syncStatus.includes('opencode-config-missing') && (
                <p className="text-[var(--color-error)]">
                  Sync failed: {syncStatus}
                </p>
              )}
          </div>
        )}
      </div>
    </div>
  );

  const renderSessionsSection = (): React.ReactElement => (
    <div className="space-y-2">
      <Toggle
        id="settings-auto-restore"
        checked={settings.autoRestoreSessions}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, autoRestoreSessions: !s.autoRestoreSessions } : s,
          )
        }
        label="Auto-restore unfinished sessions"
        description="Reopen persisted session tabs when the app starts"
      />

      <Toggle
        id="settings-auto-register"
        checked={settings.autoRegisterSubagents}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, autoRegisterSubagents: !s.autoRegisterSubagents } : s,
          )
        }
        label="Auto-register sessions"
        description="Automatically add all OpenCode sessions (root and subagents) as channels in the sidebar"
      />
    </div>
  );

  const renderDocumentationSection = (): React.ReactElement => (
    <div className="space-y-2">
      <Toggle
        id="settings-doc-indexing"
        checked={settings.docIndexingEnabled}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, docIndexingEnabled: !s.docIndexingEnabled } : s,
          )
        }
        label="Repository Doc Indexing"
        description="Index and inject repo docs when an agent connects"
      />

      <Toggle
        id="settings-doc-debug"
        checked={settings.docContextDebug}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, docContextDebug: !s.docContextDebug } : s,
          )
        }
        label="Doc Context Debug Mode"
        description="Inject doc context without <system-reminder> tags — raw content visible in OpenCode session log"
      />
    </div>
  );

  const renderPreferencesSection = (): React.ReactElement => (
    <div className="space-y-2">
      <Toggle
        id="settings-sound"
        checked={settings.soundEnabled}
        onChange={() =>
          setSettings((s) => (s ? { ...s, soundEnabled: !s.soundEnabled } : s))
        }
        label="Notification Sound"
        description="Play a sound when a prompt arrives"
      />

      <Toggle
        id="settings-launch"
        checked={settings.launchAtLogin}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, launchAtLogin: !s.launchAtLogin } : s,
          )
        }
        label="Launch at Login"
        description="Start the app automatically when you log in"
      />

      <Toggle
        id="settings-compact"
        checked={settings.compactMode}
        onChange={() =>
          setSettings((s) => (s ? { ...s, compactMode: !s.compactMode } : s))
        }
        label="Compact Mode"
        description="Reduce padding, margins, and font sizes for a denser layout"
      />

      {/* Tool Auto-Expand Exclusions */}
      <ToolExclusionsSection
        settings={settings}
        onUpdateExclusions={(exclusions) =>
          setSettings((s) =>
            s ? { ...s, toolAutoExpandExclusions: exclusions } : s,
          )
        }
      />
    </div>
  );

  const renderAdvancedSection = (): React.ReactElement => (
    <div className="space-y-6">
      {/* Extra MCP servers */}
      <div>
        <label
          htmlFor="settings-extra-mcp"
          className="block text-sm text-[var(--color-text-muted)] mb-1"
        >
          Extra MCP Servers
        </label>
        <textarea
          id="settings-extra-mcp"
          rows={6}
          value={settings.extraMcpServers}
          onChange={(e) =>
            setSettings((s) =>
              s ? { ...s, extraMcpServers: e.target.value } : s,
            )
          }
          spellCheck={false}
          aria-describedby="settings-extra-mcp-help"
          placeholder={`{\n  "test": {\n    "type": "local",\n    "command": "python",\n    "args": ["-m", "test.mcp_server"]\n  }\n}`}
          className="w-full font-mono text-xs bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)] resize-y"
        />
        <p
          id="settings-extra-mcp-help"
          className="text-xs text-[var(--color-text-faint)] mt-1"
        >
          Paste a JSON object of additional MCP server entries to include
          alongside interactive-desktop when syncing opencode.json. Click
          Register provider config to apply. Invalid or empty JSON is silently
          ignored.
        </p>
      </div>

      {/* Database reset */}
      <div className="pt-4 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={async () => {
            const confirmed = window.confirm(
              'This will clear all session channels, registered connections, queued messages, and conversation history. Continue?',
            );
            if (!confirmed) return;

            try {
              const result = await window.api.resetDatabase();
              if (result.ok) {
                setDbResetStatus(
                  `Database cleared (${result.clearedTables.length} tables, ${result.removedIdFiles} id files removed).`,
                );
              } else {
                setDbResetStatus('Database reset failed.');
              }
            } catch {
              setDbResetStatus('Database reset failed.');
            }
            setTimeout(() => setDbResetStatus(null), 4000);
          }}
          className="px-3 py-1.5 rounded-sm border border-[var(--color-error)] text-sm text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          Clear Local Database
        </button>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          Use only for recovery/debugging. This permanently deletes local
          desktop session state and history.
        </p>
        {dbResetStatus && (
          <p className="text-xs text-[var(--color-warning,orange)] mt-1">
            {dbResetStatus}
          </p>
        )}
      </div>

      {/* Info */}
      <div className="pt-4 border-t border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-text-faint)]">
          Interactive MCP Desktop v1.0.0
        </p>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          MCP client config (HTTP):{' '}
          <code className="text-[var(--color-text-muted)]">
            http://localhost:{settings.port}/mcp
          </code>
        </p>
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-[var(--color-text-faint)]">
              Provider config snippet:
            </p>
            <button
              type="button"
              onClick={() => {
                const snippet = JSON.stringify(
                  {
                    mcp: {
                      'interactive-desktop': {
                        type: 'remote',
                        url: `http://localhost:${settings.port}/mcp`,
                      },
                    },
                  },
                  null,
                  2,
                );
                navigator.clipboard.writeText(snippet).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              aria-label="Copy MCP config snippet"
              className="px-1.5 py-0.5 rounded-sm border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-[11px] leading-relaxed text-[var(--color-text-muted)] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-sm p-2 overflow-x-auto">
            {JSON.stringify(
              {
                mcp: {
                  'interactive-desktop': {
                    type: 'remote',
                    url: `http://localhost:${settings.port}/mcp`,
                  },
                },
              },
              null,
              2,
            )}
          </pre>
        </div>
      </div>
    </div>
  );

  const renderSectionContent = (): React.ReactElement => {
    switch (activeSection) {
      case 'server':
        return renderServerSection();
      case 'provider':
        return renderProviderSection();
      case 'sessions':
        return renderSessionsSection();
      case 'documentation':
        return renderDocumentationSection();
      case 'preferences':
        return renderPreferencesSection();
      case 'advanced':
        return renderAdvancedSection();
    }
  };

  const activeSectionLabel =
    SECTIONS.find((s) => s.id === activeSection)?.label ?? 'Settings';

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <nav className="w-48 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
        <h2 className="text-base font-medium text-[var(--color-text)] mb-4">
          Settings
        </h2>
        <ul className="space-y-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm transition-colors text-left ${
                  activeSection === section.id
                    ? 'bg-[var(--color-agent)]/15 text-[var(--color-agent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
                }`}
              >
                <span className="text-xs">{section.icon}</span>
                <span>{section.label}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* Save status */}
        <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
          <p
            className="text-xs text-[var(--color-text-faint)]"
            aria-live="polite"
          >
            {saveState === 'saving'
              ? 'Saving...'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'error'
                  ? 'Save failed'
                  : !isFormValid
                    ? 'Invalid values'
                    : isDirty
                      ? 'Unsaved changes'
                      : 'All saved'}
          </p>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <h3 className="text-sm font-medium text-[var(--color-text)] mb-4 pb-2 border-b border-[var(--color-border)]">
          {activeSectionLabel}
        </h3>
        <div className="max-w-2xl">{renderSectionContent()}</div>
      </main>
    </div>
  );
}
