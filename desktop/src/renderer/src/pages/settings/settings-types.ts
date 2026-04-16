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
  extraMcpServers: string;
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
};

export type SettingsSection =
  | 'server'
  | 'provider'
  | 'sessions'
  | 'documentation'
  | 'permissions'
  | 'preferences'
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

export const SECTIONS: { id: SettingsSection; label: string; icon: string }[] =
  [
    { id: 'server', label: 'Server', icon: '⚙' },
    { id: 'provider', label: 'Provider', icon: '⬡' },
    { id: 'sessions', label: 'Sessions', icon: '◎' },
    { id: 'documentation', label: 'Documentation', icon: '📄' },
    { id: 'permissions', label: 'Permissions', icon: '🔒' },
    { id: 'preferences', label: 'Preferences', icon: '🔔' },
    { id: 'advanced', label: 'Advanced', icon: '⚡' },
  ];
