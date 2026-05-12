import { Button } from '@/components/ui/button';
import { useTheme } from '../../ThemeContext';
import { Toggle, ToolExclusionsSection } from './SettingsFormParts';
import type { AppSettings } from './settings-types';

type SharedProps = {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
};

export function PermissionsSection({
  settings,
  setSettings,
}: SharedProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* Allowed Read Folders */}
      <div>
        <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">
          Allowed Read Folders
        </h4>
        <p className="text-xs text-[var(--color-text-faint)] mb-2">
          File read requests within these folders are auto-approved.
        </p>
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

      {/* Allowed Permissions (non-file-read) */}
      <div>
        <h4 className="text-sm font-medium text-[var(--color-text)] mb-2">
          Allowed Permissions
        </h4>
        <p className="text-xs text-[var(--color-text-faint)] mb-2">
          These tool permissions are auto-approved (e.g., Bash, Write, Edit).
        </p>
        <div className="space-y-1 mb-3">
          {(settings.allowedPermissions ?? []).length === 0 ? (
            <p className="text-xs text-[var(--color-text-faint)] italic py-2">
              No permissions configured. Click &quot;Always&quot; on a
              permission request to add one.
            </p>
          ) : (
            (settings.allowedPermissions ?? []).map((permission) => (
              <div
                key={permission}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[var(--color-surface-alt)] border border-[var(--color-border)]"
              >
                <span className="text-xs font-mono text-[var(--color-text-muted)] truncate flex-1">
                  {permission}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await window.api.removeAllowedPermission(permission);
                    setSettings((s) =>
                      s
                        ? {
                            ...s,
                            allowedPermissions: (
                              s.allowedPermissions ?? []
                            ).filter(
                              (p) =>
                                p.toLowerCase() !== permission.toLowerCase(),
                            ),
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
      </div>
    </div>
  );
}

export function PreferencesSection({
  settings,
  setSettings,
}: SharedProps): React.ReactElement {
  const { theme } = useTheme();

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
      <Toggle
        id="settings-hide-system-reminders"
        checked={settings.hideSystemReminders ?? false}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, hideSystemReminders: !s.hideSystemReminders } : s,
          )
        }
        label="Hide System Reminders"
        description="Hide <system-reminder> tags in the chat view"
      />
      <Toggle
        id="settings-hide-doc-injections"
        checked={settings.hideDocInjections ?? false}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, hideDocInjections: !s.hideDocInjections } : s,
          )
        }
        label="Hide Doc Injections"
        description="Hide repository documentation context in the chat view"
      />
      <Toggle
        id="settings-wrap-code-blocks"
        checked={settings.wrapCodeBlocks ?? true}
        onChange={() =>
          setSettings((s) =>
            s ? { ...s, wrapCodeBlocks: !(s.wrapCodeBlocks ?? true) } : s,
          )
        }
        label="Wrap lines in code blocks"
        description="Wrap long lines in tool output and code blocks instead of horizontal scrolling"
      />

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
