import type React from 'react';
import {
  AdvancedSection,
  PermissionsSection,
  PreferencesSection,
} from './SettingsSectionMore';
import {
  DocumentationSection,
  ProviderSection,
  ServerSection,
  SessionSection,
} from './SettingsSectionBasics';
import { AgentsSection } from './SettingsSectionAgents';
import { OpenCodeConfigSection } from './SettingsSectionOpenCode';
import type { SettingsSection } from './settings-types';
import type { useSettingsState } from './useSettingsState';

/**
 * Full settings state object returned by `useSettingsState`. Every registered
 * section receives this state object and pulls out what it needs via an
 * adapter component.
 */
export type SettingsStateShape = ReturnType<typeof useSettingsState>;

/**
 * Registry entry describing a single settings section.
 *
 * The registry-level component receives the full settings state and is
 * responsible for extracting the specific props its underlying section
 * component needs. This keeps `SettingsView` free of per-section prop
 * plumbing: new sections can be added by registering here without modifying
 * the renderer.
 */
export type SettingsSectionDefinition = {
  id: SettingsSection;
  label: string;
  icon: string;
  component: React.ComponentType<{ state: SettingsStateShape }>;
};

// --- Adapters (module-level, per react-perf-patterns) ------------------------
// Each adapter pulls the props its underlying section needs from the full
// state object. They are defined at module scope so they are stable across
// renders (no inline components inside `SettingsView`).

function ServerAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <ServerSection
      portInput={state.portInput}
      setPortInput={state.setPortInput}
      openCodePortInput={state.openCodePortInput}
      setOpenCodePortInput={state.setOpenCodePortInput}
      timeoutInput={state.timeoutInput}
      setTimeoutInput={state.setTimeoutInput}
      isPortValid={state.isPortValid}
      isOpenCodePortValid={state.isOpenCodePortValid}
      isTimeoutValid={state.isTimeoutValid}
    />
  );
}

function ProviderAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <ProviderSection
      settings={state.settings}
      setSettings={state.setSettings}
      providerStatusText={state.providerStatusText}
      syncStatus={state.syncStatus}
      setSyncStatus={state.setSyncStatus}
    />
  );
}

function SessionAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <SessionSection settings={state.settings} setSettings={state.setSettings} />
  );
}

function DocumentationAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <DocumentationSection
      settings={state.settings}
      setSettings={state.setSettings}
    />
  );
}

function PermissionsAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <PermissionsSection
      settings={state.settings}
      setSettings={state.setSettings}
    />
  );
}

function PreferencesAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <PreferencesSection
      settings={state.settings}
      setSettings={state.setSettings}
    />
  );
}

// Adapters that do not consume `state`. We still accept the prop so the
// component signature matches `SettingsSectionDefinition['component']`.
const AgentsAdapter: React.ComponentType<{
  state: SettingsStateShape;
}> = () => <AgentsSection />;

const OpenCodeConfigAdapter: React.ComponentType<{
  state: SettingsStateShape;
}> = () => <OpenCodeConfigSection />;

function AdvancedAdapter({
  state,
}: {
  state: SettingsStateShape;
}): React.ReactElement | null {
  if (!state.settings) return null;
  return (
    <AdvancedSection
      settings={state.settings}
      setSettings={state.setSettings}
      copied={state.copied}
      setCopied={state.setCopied}
      dbResetStatus={state.dbResetStatus}
      setDbResetStatus={state.setDbResetStatus}
    />
  );
}

// --- Registry ----------------------------------------------------------------

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  { id: 'server', label: 'Server', icon: '⚙', component: ServerAdapter },
  { id: 'provider', label: 'Provider', icon: '⬡', component: ProviderAdapter },
  { id: 'sessions', label: 'Sessions', icon: '◎', component: SessionAdapter },
  {
    id: 'documentation',
    label: 'Documentation',
    icon: '📄',
    component: DocumentationAdapter,
  },
  {
    id: 'permissions',
    label: 'Permissions',
    icon: '🔒',
    component: PermissionsAdapter,
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: '🔔',
    component: PreferencesAdapter,
  },
  { id: 'agents', label: 'Agents', icon: '🤖', component: AgentsAdapter },
  {
    id: 'opencode-config',
    label: 'OpenCode Config',
    icon: '📝',
    component: OpenCodeConfigAdapter,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: '⚡',
    component: AdvancedAdapter,
  },
];

export function getSectionById(
  id: SettingsSection,
): SettingsSectionDefinition | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id);
}

export function getSectionIds(): SettingsSection[] {
  return SETTINGS_SECTIONS.map((s) => s.id);
}
