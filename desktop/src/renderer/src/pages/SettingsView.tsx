import { useState, useEffect } from 'react';

type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  noReplyInjection: boolean;
  autoStartOpenCode: boolean;
  autoSyncOpencode: boolean;
};

export default function SettingsView(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const [portInput, setPortInput] = useState('');
  const [timeoutInput, setTimeoutInput] = useState('');
  const [openCodePortInput, setOpenCodePortInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setInitialSettings(s);
      setPortInput(String(s.port));
      setTimeoutInput(String(s.promptTimeoutSeconds));
      setOpenCodePortInput(String(s.openCodePort));
    });
  }, []);

  if (!settings || !initialSettings) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-faint)] text-sm">
        Loading settings…
      </div>
    );
  }

  const save = async (): Promise<void> => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1024 || port > 65535) return;
    const timeout = parseInt(timeoutInput, 10);
    if (isNaN(timeout) || timeout < 0) return;
    const openCodePort = parseInt(openCodePortInput, 10);
    if (isNaN(openCodePort) || openCodePort < 1024 || openCodePort > 65535)
      return;

    const updated = {
      ...settings,
      port,
      promptTimeoutSeconds: timeout,
      openCodePort,
    };
    await window.api.saveSettings(updated);
    setSettings(updated);
    setInitialSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const port = parseInt(portInput, 10);
  const timeout = parseInt(timeoutInput, 10);
  const openCodePort = parseInt(openCodePortInput, 10);
  const isPortValid = !isNaN(port) && port >= 1024 && port <= 65535;
  const isTimeoutValid = !isNaN(timeout) && timeout >= 0;
  const isOpenCodePortValid =
    !isNaN(openCodePort) && openCodePort >= 1024 && openCodePort <= 65535;
  const isFormValid = isPortValid && isTimeoutValid && isOpenCodePortValid;
  const isDirty =
    portInput !== String(initialSettings.port) ||
    timeoutInput !== String(initialSettings.promptTimeoutSeconds) ||
    openCodePortInput !== String(initialSettings.openCodePort) ||
    settings.soundEnabled !== initialSettings.soundEnabled ||
    settings.launchAtLogin !== initialSettings.launchAtLogin ||
    settings.autoRestoreSessions !== initialSettings.autoRestoreSessions ||
    settings.docIndexingEnabled !== initialSettings.docIndexingEnabled ||
    settings.noReplyInjection !== initialSettings.noReplyInjection ||
    settings.autoStartOpenCode !== initialSettings.autoStartOpenCode ||
    settings.autoSyncOpencode !== initialSettings.autoSyncOpencode;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6">
      <h2 className="text-base font-medium text-[var(--color-text)] mb-6">
        Settings
      </h2>

      <div className="space-y-6 max-w-md">
        {/* Port */}
        <div>
          <label
            htmlFor="settings-port"
            className="block text-sm text-[var(--color-text-muted)] mb-1"
          >
            MCP Server Port
          </label>
          <input
            id="settings-port"
            type="number"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            min={1024}
            max={65535}
            aria-invalid={!isPortValid}
            aria-describedby="settings-port-help"
            className="w-32 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
          />
          <p
            id="settings-port-help"
            className="text-xs text-[var(--color-text-faint)] mt-1"
          >
            Range: 1024–65535. Requires restart if changed.
          </p>
          {!isPortValid && (
            <p className="text-xs text-[var(--color-error)] mt-1">
              Enter a valid port between 1024 and 65535.
            </p>
          )}
        </div>

        {/* Prompt Timeout */}
        <div>
          <label
            htmlFor="settings-timeout"
            className="block text-sm text-[var(--color-text-muted)] mb-1"
          >
            Prompt Timeout (seconds)
          </label>
          <input
            id="settings-timeout"
            type="number"
            value={timeoutInput}
            onChange={(e) => setTimeoutInput(e.target.value)}
            min={0}
            aria-invalid={!isTimeoutValid}
            aria-describedby="settings-timeout-help"
            className="w-32 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
          />
          <p
            id="settings-timeout-help"
            className="text-xs text-[var(--color-text-faint)] mt-1"
          >
            How long to wait for a response before the tool call times out. 0 =
            no timeout.
          </p>
          {!isTimeoutValid && (
            <p className="text-xs text-[var(--color-error)] mt-1">
              Timeout must be 0 or greater.
            </p>
          )}
        </div>

        {/* OpenCode API Port */}
        <div>
          <label
            htmlFor="settings-opencode-port"
            className="block text-sm text-[var(--color-text-muted)] mb-1"
          >
            OpenCode API Port
          </label>
          <input
            id="settings-opencode-port"
            type="number"
            value={openCodePortInput}
            onChange={(e) => setOpenCodePortInput(e.target.value)}
            min={1024}
            max={65535}
            aria-invalid={!isOpenCodePortValid}
            aria-describedby="settings-opencode-port-help"
            className="w-32 bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-sm px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-tool)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-agent)]"
          />
          <p
            id="settings-opencode-port-help"
            className="text-xs text-[var(--color-text-faint)] mt-1"
          >
            Port used to inject context into OpenCode sessions.
          </p>
          {!isOpenCodePortValid && (
            <p className="text-xs text-[var(--color-error)] mt-1">
              Enter a valid port between 1024 and 65535.
            </p>
          )}
        </div>

        {/* Sound */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Notification Sound
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              Play a sound when a prompt arrives
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, soundEnabled: !s.soundEnabled } : s,
              )
            }
            role="switch"
            aria-checked={settings.soundEnabled}
            aria-label="Notification Sound"
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.soundEnabled
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.soundEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Launch at login */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Launch at Login
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              Start the app automatically when you log in
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, launchAtLogin: !s.launchAtLogin } : s,
              )
            }
            role="switch"
            aria-checked={settings.launchAtLogin}
            aria-label="Launch at Login"
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.launchAtLogin
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.launchAtLogin ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Auto restore sessions */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Auto-restore unfinished sessions
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              Reopen persisted session tabs when the app starts
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, autoRestoreSessions: !s.autoRestoreSessions } : s,
              )
            }
            role="switch"
            aria-checked={settings.autoRestoreSessions}
            aria-label="Auto-restore unfinished sessions"
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.autoRestoreSessions
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.autoRestoreSessions ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Doc indexing */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Repository Doc Indexing
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              Index and inject repo docs when an agent connects
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, docIndexingEnabled: !s.docIndexingEnabled } : s,
              )
            }
            role="switch"
            aria-checked={settings.docIndexingEnabled}
            aria-label="Repository Doc Indexing"
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
              settings.docIndexingEnabled
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.docIndexingEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Message injection mode */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Context-only messages
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              When on, queued messages appear in the session log but do not
              trigger an agent response. When off, messages trigger the agent to
              respond.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, noReplyInjection: !s.noReplyInjection } : s,
              )
            }
            role="switch"
            aria-checked={settings.noReplyInjection}
            aria-label="Context-only messages"
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
              settings.noReplyInjection
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.noReplyInjection ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Auto-start OpenCode serve */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Auto-start OpenCode server
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              Automatically run{' '}
              <code className="text-[var(--color-text-muted)]">
                opencode serve
              </code>{' '}
              on the configured port when the app starts
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, autoStartOpenCode: !s.autoStartOpenCode } : s,
              )
            }
            role="switch"
            aria-checked={settings.autoStartOpenCode}
            aria-label="Auto-start OpenCode server"
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
              settings.autoStartOpenCode
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.autoStartOpenCode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Auto-sync OpenCode config */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Auto-sync OpenCode config
            </p>
            <p className="text-xs text-[var(--color-text-faint)]">
              Write a remote MCP entry into{' '}
              <code className="text-[var(--color-text-muted)]">
                opencode.json
              </code>{' '}
              on startup (fallback)
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSettings((s) =>
                s ? { ...s, autoSyncOpencode: !s.autoSyncOpencode } : s,
              )
            }
            role="switch"
            aria-checked={settings.autoSyncOpencode}
            aria-label="Auto-sync OpenCode config"
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
              settings.autoSyncOpencode
                ? 'bg-[var(--color-agent)]'
                : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.autoSyncOpencode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Manual sync button */}
        <div>
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
            Register with OpenCode
          </button>
          {syncStatus && (
            <div className="text-xs mt-1 space-y-0.5" aria-live="polite">
              {syncStatus.includes('register=registered') && (
                <p className="text-[var(--color-agent)]">
                  Registered with OpenCode
                </p>
              )}
              {syncStatus.includes('register=unreachable') && (
                <p className="text-[var(--color-warning,orange)]">
                  OpenCode not reachable
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

        {/* Save button */}
        <div className="pt-4">
          <button
            type="button"
            onClick={save}
            disabled={!isFormValid || !isDirty}
            className="px-4 py-1.5 rounded-sm bg-[var(--color-agent)] text-black text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saved ? '✓ Saved' : 'Save Settings'}
          </button>
          <p
            className="text-xs text-[var(--color-text-faint)] mt-2"
            aria-live="polite"
          >
            {saved
              ? 'Settings saved.'
              : isDirty
                ? 'Unsaved changes.'
                : 'No unsaved changes.'}
          </p>
        </div>

        {/* Info */}
        <div className="pt-6 border-t border-[var(--color-border)]">
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
                OpenCode config snippet:
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
    </div>
  );
}
