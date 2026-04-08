import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export interface AppSettings {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  /** When true, the desktop app spawns `opencode serve` automatically on startup. Default: true. */
  autoStartOpenCode: boolean;
  /** When true, syncRemoteConfig() runs automatically at startup. Default: true. */
  autoSyncOpencode: boolean;
  /**
   * When true, doc context is injected without <system-reminder> wrapping so the
   * raw content is visible as a plain message in the OpenCode session log.
   * Default: false (wrapping is on).
   */
  docContextDebug: boolean;
}

export const defaultSettings: AppSettings = {
  port: 3100,
  soundEnabled: true,
  launchAtLogin: false,
  promptTimeoutSeconds: 800,
  autoRestoreSessions: false,
  openCodePort: 4096,
  docIndexingEnabled: true,
  autoStartOpenCode: true,
  autoSyncOpencode: true,
  docContextDebug: false,
};

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath();
  if (!existsSync(path)) return { ...defaultSettings };
  try {
    return { ...defaultSettings, ...JSON.parse(readFileSync(path, 'utf-8')) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}
