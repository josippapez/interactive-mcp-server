import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Toggle, ToolExclusionsSection } from './SettingsFormParts';
import type { AppSettings } from './settings-types';
import { useTheme, type LightTint } from '../../ThemeContext';

type SharedProps = {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
};

export function PermissionsSection({
  settings,
  setSettings,
}: SharedProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">
          Allowed Read Folders
        </h4>
        <div className="space-y-1 mb-3">
          {(settings.allowedReadFolders ?? []).length === 0 ? (
            <p className="text-xs text-[var(--color-text-faint)] italic py-2">
              No folders configured.
            </p>
          ) : (
            (settings.allowedReadFolders ?? []).map((folder) => (
              <div
                key={folder}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[var(--color-surface-alt)] border border-[var(--color-border)]"
              >
                <span className="text-xs font-mono text-[var(--color-text-muted)] truncate flex-1">
                  {folder}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await window.api.removeAllowedReadFolder(folder);
                    setSettings((s) =>
                      s
                        ? {
                            ...s,
                            allowedReadFolders: (
                              s.allowedReadFolders ?? []
                            ).filter((f) => f !== folder),
                          }
                        : s,
                    );
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)]"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <Button
          variant="outline"
          onClick={async () => {
            const result = await window.api.selectFolderDialog();
            if (!result.canceled && result.folderPath) {
              await window.api.addAllowedReadFolder(result.folderPath);
              setSettings((s) =>
                s
                  ? {
                      ...s,
                      allowedReadFolders: [
                        ...(s.allowedReadFolders ?? []),
                        result.folderPath!,
                      ],
                    }
                  : s,
              );
            }
          }}
        >
          Add Folder...
        </Button>
      </div>
    </div>
  );
}

const TINTS: { id: LightTint; label: string; bg: string; ring: string }[] = [
  { id: 'none', label: 'Default', bg: '#c4cdd9', ring: '#7a91a6' },
  { id: 'sage', label: 'Sage', bg: '#bdd0c2', ring: '#7a9f86' },
  { id: 'sand', label: 'Sand', bg: '#d4c9bc', ring: '#a89080' },
  { id: 'teal', label: 'Teal', bg: '#b8cecc', ring: '#6a9e9c' },
  { id: 'sky', label: 'Sky', bg: '#b8cedc', ring: '#6a8faa' },
];

export function PreferencesSection({
  settings,
  setSettings,
}: SharedProps): React.ReactElement {
  const { theme, lightTint, setLightTint } = useTheme();

  return (
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
        description="Reduce padding and font sizes for a denser layout"
      />

      {theme === 'light' && (
        <div className="pt-3 pb-1">
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">
            Light mode tint
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {TINTS.map((tint) => {
              const isActive = lightTint === tint.id;
              return (
                <button
                  key={tint.id}
                  type="button"
                  title={tint.label}
                  onClick={() => setLightTint(tint.id)}
                  className="flex flex-col items-center gap-1 group"
                >
                  <span
                    className="w-7 h-7 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: tint.bg,
                      borderColor: isActive ? tint.ring : 'transparent',
                      outline: isActive
                        ? `2px solid ${tint.ring}`
                        : '2px solid transparent',
                      outlineOffset: '2px',
                    }}
                  />
                  <span
                    className="text-[10px] transition-colors"
                    style={{
                      color: isActive
                        ? 'var(--color-text)'
                        : 'var(--color-text-faint)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {tint.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
}

export function AdvancedSection({
  settings,
  setSettings,
  copied,
  setCopied,
  dbResetStatus,
  setDbResetStatus,
}: SharedProps & {
  copied: boolean;
  setCopied: (value: boolean) => void;
  dbResetStatus: string | null;
  setDbResetStatus: (value: string | null) => void;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <label
          htmlFor="settings-extra-mcp"
          className="block text-sm text-[var(--color-text-muted)] mb-1"
        >
          Extra MCP Servers
        </label>
        <Textarea
          id="settings-extra-mcp"
          rows={6}
          value={settings.extraMcpServers}
          onChange={(e) =>
            setSettings((s) =>
              s ? { ...s, extraMcpServers: e.target.value } : s,
            )
          }
          spellCheck={false}
          className="w-full font-mono text-xs"
        />
      </div>

      <div className="pt-4 border-t border-[var(--color-border)]">
        <Button
          variant="destructive"
          onClick={async () => {
            const confirmed = window.confirm(
              'This will clear local session state. Continue?',
            );
            if (!confirmed) return;
            try {
              const result = await window.api.resetDatabase();
              setDbResetStatus(
                result.ok ? 'Database cleared.' : 'Database reset failed.',
              );
            } catch {
              setDbResetStatus('Database reset failed.');
            }
            setTimeout(() => setDbResetStatus(null), 4000);
          }}
        >
          Clear Local Database
        </Button>
        {dbResetStatus && (
          <p className="text-xs text-[var(--color-warning,orange)] mt-1">
            {dbResetStatus}
          </p>
        )}
      </div>

      <div className="pt-4 border-t border-[var(--color-border)]">
        <div className="mt-3 flex items-center gap-2">
          <p className="text-xs text-[var(--color-text-faint)]">
            Provider config snippet:
          </p>
          <Button
            variant="ghost"
            size="sm"
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
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
    </div>
  );
}
