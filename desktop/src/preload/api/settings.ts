import { ipcRenderer } from 'electron';
import type { AppSettings } from './types';

export function createSettingsApi() {
  return {
    // Settings
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: AppSettings): Promise<boolean> =>
      ipcRenderer.invoke('save-settings', settings),

    // Pinned projects management
    getPinnedProjects: (): Promise<
      { path: string; name: string; createdAt: string }[]
    > => ipcRenderer.invoke('get-pinned-projects'),
    addPinnedProject: (path: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke('add-pinned-project', { path, name }),
    removePinnedProject: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('remove-pinned-project', path),

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
