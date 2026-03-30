import { app, ipcMain, BrowserWindow } from 'electron';
import { AppSettings, saveSettings } from './settings';
import { getConversationHistory, clearHistory } from './database';
import { startMcpServer, stopMcpServer } from './mcp-server';
import { indexFiles, rankFileSuggestions } from './file-indexer';

export interface IpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  getSettings: () => AppSettings;
  setSettings: (settings: AppSettings) => void;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-history', () => getConversationHistory());

  ipcMain.handle('clear-history', () => {
    clearHistory();
    return true;
  });

  ipcMain.handle('get-server-status', () => {
    return { running: true, port: deps.getSettings().port };
  });

  ipcMain.handle('get-settings', () => deps.getSettings());

  ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    const portChanged = settings.port !== deps.getSettings().port;
    deps.setSettings(settings);
    saveSettings(settings);
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    // Restart server if port changed
    if (portChanged) {
      stopMcpServer();
      startMcpServer(
        settings.port,
        deps.getMainWindow,
        () => deps.getSettings().soundEnabled,
      );
    }
    return true;
  });

  ipcMain.handle(
    'search-files',
    async (_event, baseDirectory: string, query: string) => {
      const files = await indexFiles(baseDirectory);
      return rankFileSuggestions(files, query, 50);
    },
  );
}
