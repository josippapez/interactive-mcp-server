/**
 * settings-mirror.ts — utility-process snapshot of main-side settings.
 *
 * The utility process does not load `electron-store` (that's a main-only
 * concern). Instead, main pushes a settings snapshot at startup and again
 * every time the user changes them, via a `settings-updated` bridge event.
 *
 * Modules in `utility/backend/` read through `getSettingsSnapshot()` so
 * the event-stream pump always observes the latest values without having
 * to thread settings through every call site.
 */

/** Minimal settings surface consumed by backend code. */
export interface BackendSettingsSnapshot {
  allowedPermissions: readonly string[];
  allowedReadFolders: readonly string[];
  autoRegisterSubagents: boolean;
  openCodePort: number;
  logsDir: string;
  /**
   * Electron `app.getPath('userData')` forwarded by main in the init envelope.
   * Consumed by the in-process OpenCode server to pin `XDG_STATE_HOME`.
   * Never changes at runtime, but lives on the snapshot for uniformity.
   */
  userDataPath: string;
  /** User-configured timeout for durable prompts (seconds). */
  promptTimeoutSeconds: number;
  /** Whether to beep when a prompt is raised. */
  soundEnabled: boolean;
  /** Whether the doc-indexing background worker is enabled. */
  docIndexingEnabled: boolean;
  /** Active agent backend (controls provider detection, session ID requirements). */
  agentBackend: 'opencode' | 'standalone' | 'claude_sdk';
  /** MCP Express server port (the desktop app's own MCP listener). */
  mcpPort: number;
}

const DEFAULT_SNAPSHOT: BackendSettingsSnapshot = {
  allowedPermissions: [],
  allowedReadFolders: [],
  autoRegisterSubagents: true,
  openCodePort: 4096,
  logsDir: '',
  userDataPath: '',
  promptTimeoutSeconds: 200,
  soundEnabled: true,
  docIndexingEnabled: true,
  agentBackend: 'standalone',
  mcpPort: 3001,
};

let _snapshot: BackendSettingsSnapshot = DEFAULT_SNAPSHOT;

/**
 * Replace the current snapshot. Called by `entry.ts` on bootstrap and
 * whenever main emits `settings-updated` over the bridge.
 *
 * Partial updates are merged onto the previous snapshot — main may choose
 * to push only the fields that changed.
 */
export function updateSettingsSnapshot(
  next: Partial<BackendSettingsSnapshot>,
): void {
  _snapshot = { ..._snapshot, ...next };
}

/** Returns the current snapshot by reference (caller must not mutate). */
export function getSettingsSnapshot(): BackendSettingsSnapshot {
  return _snapshot;
}

/** Reset to defaults — used by tests. */
export function _resetSettingsSnapshotForTest(): void {
  _snapshot = DEFAULT_SNAPSHOT;
}
