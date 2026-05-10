import { ipcRenderer } from 'electron';
import type { AppSettings } from './types';

export type ResolvedPortsPayload = {
  mcpRequestedPort: number;
  mcpResolvedPort: number;
  openCodeRequestedPort: number;
  openCodeResolvedPort: number;
};

export function createSettingsApi() {
  return {
    // Settings
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: AppSettings): Promise<boolean> =>
      ipcRenderer.invoke('save-settings', settings),

    /**
     * Returns the actually-bound MCP and OpenCode ports plus the
     * user-requested values from disk. Renderer Settings UI surfaces the
     * resolved value as a read-only hint when it differs from the request
     * (e.g. another Eden instance occupied the configured port and the
     * resolver probed upward).
     */
    getResolvedPorts: (): Promise<ResolvedPortsPayload> =>
      ipcRenderer.invoke('get-resolved-ports'),

    /**
     * Subscribe to resolved-port changes pushed from main. Fires after
     * MCP/OpenCode start, save-settings restarts, and supervisor rebinds.
     * The event carries the **full payload** (requested + resolved
     * values) — renderer does NOT need to follow up with a
     * `getResolvedPorts()` invoke. Returns an unsubscribe function.
     */
    onResolvedPortsChanged: (
      callback: (payload: ResolvedPortsPayload) => void,
    ): (() => void) => {
      const listener = (_e: unknown, payload: ResolvedPortsPayload) =>
        callback(payload);
      ipcRenderer.on('resolved-ports:changed', listener);
      return () => {
        ipcRenderer.removeListener('resolved-ports:changed', listener);
      };
    },

    // Pinned projects management
    getPinnedProjects: (): Promise<
      { path: string; name: string; createdAt: string }[]
    > => ipcRenderer.invoke('get-pinned-projects'),
    addPinnedProject: (path: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke('add-pinned-project', { path, name }),
    removePinnedProject: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('remove-pinned-project', path),

    /**
     * Subscribe to pinned-project changes. The main process emits this event
     * on add/remove so every consumer (project picker, sidebar rail, etc.)
     * can refetch in sync. Returns an unsubscribe function.
     */
    onPinnedProjectsUpdated: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('pinned-projects:updated', listener);
      return () => {
        ipcRenderer.removeListener('pinned-projects:updated', listener);
      };
    },

    // ─── Allowed Read Folders Management ─────────────────────────────────────────
    addAllowedReadFolder: (folderPath: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('add-allowed-read-folder', folderPath),

    removeAllowedReadFolder: (folderPath: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('remove-allowed-read-folder', folderPath),

    getAllowedReadFolders: (): Promise<string[]> =>
      ipcRenderer.invoke('get-allowed-read-folders'),

    addAllowedPermission: (permission: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('add-allowed-permission', permission),

    removeAllowedPermission: (permission: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('remove-allowed-permission', permission),

    getAllowedPermissions: (): Promise<string[]> =>
      ipcRenderer.invoke('get-allowed-permissions'),
  };
}
