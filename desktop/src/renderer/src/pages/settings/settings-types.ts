export type AppSettings = {
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
  compactMode: boolean;
  toolAutoExpandExclusions: string[];
  discoveredTools: string[];
  defaultNoReply: boolean;
  defaultExpandAllTools: boolean;
  defaultShowThinking: boolean;
  allowedReadFolders: string[];
  allowedPermissions: string[];
  hideSystemReminders: boolean;
  hideDocInjections: boolean;
  chatTextSize: 'sm' | 'md' | 'lg';
  wrapCodeBlocks: boolean;
  defaultModelId: string;
  defaultProviderId: string;
  defaultReasoningVariant: string;
};

export type SettingsSection =
  | 'server'
  | 'provider'
  | 'sessions'
  | 'documentation'
  | 'permissions'
  | 'preferences'
  | 'agents'
  | 'opencode-config'
  | 'advanced';

export const PREDEFINED_TOOLS = [
  'Edit',
  'Read',
  'Write',
  'Bash',
  'Grep',
  'Glob',
  'WebFetch',
  'TodoWrite',
  'Task',
  'Gather Context',
  'question',
  'skill',
] as const;

// `SECTIONS` is now a thin re-export derived from the section registry so
// that the sidebar and the content renderer share one source of truth.
// See `./section-registry.tsx`.
export type SectionListEntry = {
  id: SettingsSection;
  label: string;
  icon: string;
};

// Re-exported from the registry module. Declared here as a pass-through so
// that callers importing `SECTIONS` keep working after the registry was
// introduced. The registry imports `SettingsSection` from this file, not the
// other way around, to avoid a circular import surface.
export { SETTINGS_SECTIONS as SECTIONS } from './section-registry';
