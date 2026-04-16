import { app, dialog, ipcMain } from 'electron';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { saveSettings } from '../../settings';
import {
  clearHistory,
  getConversationHistory,
  getPinnedProjects,
  addPinnedProject,
  removePinnedProject,
  resetDatabase,
} from '../../database';
import { rankFileSuggestions, indexFiles } from '../../docs/file-indexer';
import { getBackendAdapter } from '../../backend-adapter';
import { forceTerminateChat, getActivePromptData } from '../prompt';
import { SUPPORTED_FILE_EXTENSIONS } from '../../opencode/injector';
import { replyToOpenCodePermission } from '../../opencode/permission-reply';
import { IpcHandlerDeps } from './types';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

export function registerSystemHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-history', () => getConversationHistory());

  ipcMain.handle('clear-history', () => {
    clearHistory();
    return true;
  });

  ipcMain.handle('reset-database', async () => {
    const result = resetDatabase();
    const win = deps.getMainWindow();
    win?.webContents.send('database-reset', result);
    return result;
  });

  ipcMain.handle('get-server-status', () => {
    return { running: true, port: deps.getSettings().port };
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-provider-status', async () => {
    const settings = deps.getSettings();
    const adapter = await getBackendAdapter(settings.agentBackend);
    const effectiveMode =
      settings.agentBackend === 'claude_sdk' &&
      !adapter.supportsProviderInjection
        ? 'standalone_compat'
        : settings.agentBackend;

    return {
      backend: settings.agentBackend,
      effectiveMode,
      supportsSessionHierarchy: adapter.supportsSessionHierarchy,
      supportsProviderInjection: adapter.supportsProviderInjection,
      runtime: adapter.runtime,
    };
  });

  ipcMain.handle(
    'search-files',
    async (_event, baseDirectory: string, query: string) => {
      const files = await indexFiles(baseDirectory);
      return rankFileSuggestions(files, query, 50);
    },
  );

  ipcMain.handle('open-file-dialog', async () => {
    const win = deps.getMainWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images & Text',
          extensions: SUPPORTED_FILE_EXTENSIONS,
        },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('open-folder-dialog', async () => {
    const win = deps.getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('read-file-for-attachment', (_event, filePath: string) => {
    try {
      const buffer = readFileSync(filePath);
      const name = basename(filePath);
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const isImage = IMAGE_EXTENSIONS.includes(ext);
      if (isImage) {
        return {
          type: 'image' as const,
          data: buffer.toString('base64'),
          mimeType: IMAGE_MIME_TYPES[ext] || 'application/octet-stream',
          name,
          size: buffer.length,
        };
      }

      return {
        type: 'text' as const,
        data: buffer.toString('utf-8'),
        mimeType: 'text/plain',
        name,
        size: buffer.length,
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('force-terminate-chat', (_event, connectionId: string) => {
    forceTerminateChat(connectionId);
  });

  ipcMain.handle('get-pinned-projects', () => getPinnedProjects());

  ipcMain.handle(
    'add-pinned-project',
    (_event, data: { path: string; name: string }) => {
      return addPinnedProject(data.path, data.name);
    },
  );

  ipcMain.handle('remove-pinned-project', (_event, path: string) => {
    return removePinnedProject(path);
  });

  ipcMain.handle('get-active-prompts', () => getActivePromptData());

  ipcMain.handle('dismiss-session', (_event, connectionId: string) => {
    forceTerminateChat(connectionId);
    const win = deps.getMainWindow();
    win?.webContents.send('connection-closed', { connectionId });
  });

  ipcMain.handle('reply-permission', async (_event, data) => {
    const { openCodePort } = deps.getSettings();
    return replyToOpenCodePermission(
      openCodePort,
      data.sessionID,
      data.requestID,
      data.reply,
    );
  });

  ipcMain.handle('add-allowed-read-folder', (_event, folderPath: string) => {
    const currentSettings = deps.getSettings();
    const folders = currentSettings.allowedReadFolders ?? [];
    // Avoid duplicates
    if (!folders.includes(folderPath)) {
      const updatedSettings = {
        ...currentSettings,
        allowedReadFolders: [...folders, folderPath],
      };
      deps.setSettings(updatedSettings);
      saveSettings(updatedSettings);
    }
    return { ok: true };
  });

  ipcMain.handle('remove-allowed-read-folder', (_event, folderPath: string) => {
    const currentSettings = deps.getSettings();
    const folders = currentSettings.allowedReadFolders ?? [];
    const updatedSettings = {
      ...currentSettings,
      allowedReadFolders: folders.filter((f) => f !== folderPath),
    };
    deps.setSettings(updatedSettings);
    saveSettings(updatedSettings);
    return { ok: true };
  });

  ipcMain.handle('get-allowed-read-folders', () => {
    const currentSettings = deps.getSettings();
    return currentSettings.allowedReadFolders ?? [];
  });

  // ─── Allowed Permissions Management ─────────────────────────────────────────

  ipcMain.handle('add-allowed-permission', (_event, permission: string) => {
    const currentSettings = deps.getSettings();
    const permissions = currentSettings.allowedPermissions ?? [];
    // Normalize to lowercase and avoid duplicates
    const normalizedPermission = permission.toLowerCase();
    if (!permissions.some((p) => p.toLowerCase() === normalizedPermission)) {
      const updatedSettings = {
        ...currentSettings,
        allowedPermissions: [...permissions, permission],
      };
      deps.setSettings(updatedSettings);
      saveSettings(updatedSettings);
    }
    return { ok: true };
  });

  ipcMain.handle('remove-allowed-permission', (_event, permission: string) => {
    const currentSettings = deps.getSettings();
    const permissions = currentSettings.allowedPermissions ?? [];
    const normalizedPermission = permission.toLowerCase();
    const updatedSettings = {
      ...currentSettings,
      allowedPermissions: permissions.filter(
        (p) => p.toLowerCase() !== normalizedPermission,
      ),
    };
    deps.setSettings(updatedSettings);
    saveSettings(updatedSettings);
    return { ok: true };
  });

  ipcMain.handle('get-allowed-permissions', () => {
    const currentSettings = deps.getSettings();
    return currentSettings.allowedPermissions ?? [];
  });

  ipcMain.handle('select-folder-dialog', async () => {
    const win = deps.getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Folder to Allow',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, folderPath: result.filePaths[0] };
  });
}
