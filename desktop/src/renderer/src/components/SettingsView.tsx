import { useState, useEffect } from 'react';

type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
};

export default function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    port: 3100,
    soundEnabled: true,
    launchAtLogin: false,
    promptTimeoutSeconds: 800,
  });
  const [saved, setSaved] = useState(false);
  const [portInput, setPortInput] = useState('3100');
  const [timeoutInput, setTimeoutInput] = useState('800');

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
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
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6">
      <h2 className="text-lg font-semibold text-gray-200 mb-6">Settings</h2>

      <div className="space-y-6 max-w-md">
        {/* Port */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            SSE Server Port
          </label>
          <input
            type="number"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            min={1024}
            max={65535}
            className="w-32 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Range: 1024–65535. Requires restart if changed.
          </p>
        </div>

        {/* Prompt Timeout */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Prompt Timeout (seconds)
          </label>
          <input
            type="number"
            value={timeoutInput}
            onChange={(e) => setTimeoutInput(e.target.value)}
            min={0}
            className="w-32 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-violet-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            How long to wait for a response before the tool call times out. 0 =
            no timeout.
          </p>
        </div>

        {/* Sound */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-300">
              Notification Sound
            </p>
            <p className="text-xs text-gray-500">
              Play a sound when a prompt arrives
            </p>
          </div>
          <button
            onClick={() =>
              setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }))
            }
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.soundEnabled ? 'bg-violet-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                settings.soundEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Launch at login */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-300">Launch at Login</p>
            <p className="text-xs text-gray-500">
              Start the app automatically when you log in
            </p>
          </div>
          <button
            onClick={() =>
              setSettings((s) => ({ ...s, launchAtLogin: !s.launchAtLogin }))
            }
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.launchAtLogin ? 'bg-violet-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                settings.launchAtLogin ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Save button */}
        <div className="pt-4">
          <button
            onClick={save}
            className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            {saved ? '✓ Saved' : 'Save Settings'}
          </button>
        </div>

        {/* Info */}
        <div className="pt-6 border-t border-gray-800">
          <p className="text-xs text-gray-500">
            Interactive MCP Desktop v1.0.0
          </p>
          <p className="text-xs text-gray-600 mt-1">
            MCP client config:{' '}
            <code className="text-gray-500">
              http://localhost:{settings.port}/sse
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
