import { app, ipcMain } from 'electron';
import { AppSettings, saveSettings } from '../../settings';
import { startMcpServer, stopMcpServer } from '../../mcp-server';
import { startOpenCodeServer, stopOpenCodeServer } from '../../opencode/server';
import { syncRemoteConfig } from '../../opencode/config-sync';
import { IpcHandlerDeps } from './types';

export function registerSettingsHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-settings', () => deps.getSettings());

  ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    const prev = deps.getSettings();
    const portChanged = settings.port !== prev.port;
    deps.setSettings(settings);
    saveSettings(settings);

    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('settings-changed');
    }

    try {
      app.setLoginItemSettings({
        openAtLogin: settings.launchAtLogin,
        openAsHidden: settings.launchAtLogin,
      });
    } catch {
      // Login item registration requires app signing on macOS
    }

    if (portChanged) {
      stopMcpServer();
      startMcpServer(
        settings.port,
        deps.getMainWindow,
        () => deps.getSettings().soundEnabled,
        () => deps.getSettings().promptTimeoutSeconds * 1000,
        () => deps.getSettings().openCodePort,
        () => deps.getSettings().docIndexingEnabled,
        () => deps.getSettings().agentBackend,
      );
    }

    const openCodeEnabled = settings.agentBackend === 'opencode';

    if (openCodeEnabled && settings.autoStartOpenCode) {
      if (
        !prev.autoStartOpenCode ||
        settings.openCodePort !== prev.openCodePort
      ) {
        startOpenCodeServer(settings.openCodePort);
      }
    } else if (prev.autoStartOpenCode) {
      stopOpenCodeServer();
    }

    if (!openCodeEnabled) {
      stopOpenCodeServer();
    }

    if (openCodeEnabled && settings.autoSyncOpencode) {
      const timeoutChanged =
        settings.promptTimeoutSeconds !== prev.promptTimeoutSeconds;
      const justEnabled = !prev.autoSyncOpencode;
      if (timeoutChanged || justEnabled || portChanged) {
        syncRemoteConfig(settings.port, settings.promptTimeoutSeconds);
      }
    }
    return true;
  });
}
