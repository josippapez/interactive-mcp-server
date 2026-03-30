import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export interface AppSettings {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
}

export const defaultSettings: AppSettings = {
  port: 3100,
  soundEnabled: true,
  launchAtLogin: false,
  promptTimeoutSeconds: 800,
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
