/**
 * Main-process settings wrapper.
 *
 * Owns the settings file path (derived from `app.getPath('userData')`) and
 * delegates all read/write/merge/migrate work to the pure `settings-core`
 * module so the same logic can run inside a utility process without pulling
 * in the `electron` module.
 */

import { app } from 'electron';
import { join } from 'path';

import {
  defaultSettings,
  loadSettingsFromPath,
  saveSettingsToPath,
  type AgentBackend,
  type AppSettings,
} from './settings-core';

export {
  defaultSettings,
  PREDEFINED_TOOLS,
  migrateSettings,
  type AgentBackend,
  type AppSettings,
} from './settings-core';

// Re-exported for downstream consumers that expect the previous API.
export type { AgentBackend as SettingsAgentBackend };

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  return loadSettingsFromPath(getSettingsPath());
}

export function saveSettings(settings: AppSettings): void {
  saveSettingsToPath(getSettingsPath(), settings);
}

// Keep the default-settings re-export explicit so accidental tree-shaking
// issues during bundle refactors are caught at compile time.
void defaultSettings;
