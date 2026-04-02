import { useState, useEffect } from 'react';

type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
};

export default function SettingsView(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>({
    port: 3100,
    soundEnabled: true,
    launchAtLogin: false,
    promptTimeoutSeconds: 800,
    autoRestoreSessions: false,
  });
  const [initialSettings, setInitialSettings] = useState<AppSettings>({
    port: 3100,
    soundEnabled: true,
    launchAtLogin: false,
    promptTimeoutSeconds: 800,
    autoRestoreSessions: false,
  });
  const [saved, setSaved] = useState(false);
  const [portInput, setPortInput] = useState('3100');
  const [timeoutInput, setTimeoutInput] = useState('800');

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setInitialSettings(s);
      setPortInput(String(s.port));
      setTimeoutInput(String(s.promptTimeoutSeconds));
    });
  }, []);

  const save = async (): Promise<void> => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1024 || port > 65535) return;
    const timeout = parseInt(timeoutInput, 10);
    if (isNaN(timeout) || timeout < 0) return;

    const updated = { ...settings, port, promptTimeoutSeconds: timeout };
    await window.api.saveSettings(updated);
    setSettings(updated);
    setInitialSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const port = parseInt(portInput, 10);
  const timeout = parseInt(timeoutInput, 10);
  const isPortValid = !isNaN(port) && port >= 1024 && port <= 65535;
  const isTimeoutValid = !isNaN(timeout) && timeout >= 0;
  const isFormValid = isPortValid && isTimeoutValid;
  const isDirty =
    portInput !== String(initialSettings.port) ||
    timeoutInput !== String(initialSettings.promptTimeoutSeconds) ||
    settings.soundEnabled !== initialSettings.soundEnabled ||
    settings.launchAtLogin !== initialSettings.launchAtLogin ||
    settings.autoRestoreSessions !== initialSettings.autoRestoreSessions;

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
            onClick={() =>
              setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }))
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
            onClick={() =>
              setSettings((s) => ({ ...s, launchAtLogin: !s.launchAtLogin }))
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
            onClick={() =>
              setSettings((s) => ({
                ...s,
                autoRestoreSessions: !s.autoRestoreSessions,
              }))
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

        {/* Save button */}
        <div className="pt-4">
          <button
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
            MCP client config:{' '}
            <code className="text-[var(--color-text-muted)]">
              http://localhost:{settings.port}/mcp
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
