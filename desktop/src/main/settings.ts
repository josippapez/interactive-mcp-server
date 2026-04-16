import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export type AgentBackend = 'standalone' | 'opencode' | 'claude_sdk';

/**
 * Predefined list of common MCP tool names.
 * These are shown in the tool exclusion settings UI alongside any discovered tools.
 */
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
  /** Active provider backend for session discovery/injection behavior. */
  agentBackend: AgentBackend;
  /** When true, child OpenCode sessions are automatically registered as channels in the sidebar. Default: true. */
  autoRegisterSubagents: boolean;
  /**
   * Raw JSON object string of additional MCP server entries to include alongside
   * `interactive-desktop` when syncing `opencode.json`. Each key is a server name,
   * each value is a valid MCP server config object.
   * Example: `{ "test": { "type": "stdio", "command": "python", "args": ["-m", "test.mcp_server"] } }`
   * Default: "" (empty — no extra servers).
   */
  extraMcpServers: string;
  /**
   * When true, reduces padding, margins, and font sizes across the UI for a denser layout.
   * Default: false.
   */
  compactMode: boolean;
  /**
   * List of tool names to exclude from auto-expand when "Expand All Tools" is enabled.
   * Tools in this list will remain collapsed even when the global expand toggle is on.
   * Default: [] (no exclusions).
   */
  toolAutoExpandExclusions: string[];
  /**
   * List of tool names discovered from conversation history.
   * Combined with predefined tools to show in the exclusion settings UI.
   * Default: [] (empty — only predefined tools shown initially).
   */
  discoveredTools: string[];
  /**
   * Default state of the Reply toggle in the composer.
   * When true, messages are queued without triggering agent response (noReply mode).
   * When false, messages trigger agent response.
   * Default: true (noReply mode — queue only).
   */
  defaultNoReply: boolean;
  /**
   * Default state of the "Expand All Tools" toggle in the channel header.
   * When true, tool call outputs are expanded by default.
   * Default: false (collapsed).
   */
  defaultExpandAllTools: boolean;
  /**
   * Default state of the "Show Thinking" toggle in the channel header.
   * When true, thinking sections are expanded by default.
   * Default: false (collapsed).
   */
  defaultShowThinking: boolean;
  /**
   * List of folder paths that are allowed for automatic file read approval.
   * When a file read permission is requested for a path within any of these
   * folders (including subdirectories), it is auto-approved without user interaction.
   * Default: [] (no folders auto-approved).
   */
  allowedReadFolders: string[];
  /**
   * List of non-file-read permission names that are always auto-approved.
   * When a permission request matches one of these names (case-insensitive),
   * it is auto-approved without user interaction.
   * Example: ["Bash", "Write", "Edit"]
   * Default: [] (no permissions auto-approved).
   */
  allowedPermissions: string[];
  /**
   * Default model ID to use for new sessions (e.g., 'claude-sonnet-4-20250514').
   * When set, new channels will use this model by default.
   * Default: '' (no default — uses provider's default).
   */
  defaultModelId: string;
  /**
   * Default provider ID for the default model (e.g., 'anthropic', 'openai').
   * Required when defaultModelId is set.
   * Default: '' (no default).
   */
  defaultProviderId: string;
  /**
   * Default reasoning variant/effort level for models that support it.
   * Options typically include: 'low', 'medium', 'high'.
   * Default: '' (no default — uses model's default).
   */
  defaultReasoningVariant: string;
  /**
   * When true, hide <system-reminder> tags and their content in the chat view.
   * Default: false (show system reminders).
   */
  hideSystemReminders: boolean;
  /**
   * When true, hide doc context injection content in the chat view.
   * Default: false (show doc injections).
   */
  hideDocInjections: boolean;
}

export const defaultSettings: AppSettings = {
  port: 3100,
  soundEnabled: true,
  launchAtLogin: false,
  promptTimeoutSeconds: 1200,
  autoRestoreSessions: false,
  openCodePort: 4096,
  docIndexingEnabled: true,
  autoStartOpenCode: true,
  autoSyncOpencode: true,
  docContextDebug: false,
  agentBackend: 'opencode',
  autoRegisterSubagents: true,
  extraMcpServers: '',
  compactMode: false,
  toolAutoExpandExclusions: [],
  discoveredTools: [],
  defaultNoReply: true,
  defaultExpandAllTools: false,
  defaultShowThinking: false,
  allowedReadFolders: [],
  allowedPermissions: [],
  defaultModelId: '',
  defaultProviderId: '',
  defaultReasoningVariant: '',
  hideSystemReminders: false,
  hideDocInjections: false,
};

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** Migrations applied after merging saved settings with defaults. */
function migrateSettings(settings: AppSettings): AppSettings {
  // v1 → v2: default was mistakenly set to 200s; migrate to 1200s.
  if (settings.promptTimeoutSeconds === 200) {
    return { ...settings, promptTimeoutSeconds: 1200 };
  }
  return settings;
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath();
  if (!existsSync(path)) return { ...defaultSettings };
  try {
    const merged = {
      ...defaultSettings,
      ...JSON.parse(readFileSync(path, 'utf-8')),
    };
    const migrated = migrateSettings(merged);
    if (migrated !== merged) {
      writeFileSync(path, JSON.stringify(migrated, null, 2));
    }
    return migrated;
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}
