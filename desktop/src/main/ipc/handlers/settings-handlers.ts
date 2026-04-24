import { app, ipcMain } from 'electron';
import { AppSettings, saveSettings } from '../../settings';
import { startMcpServer, stopMcpServer } from '../../utility/mcp-server-client';
import {
  startOpenCodeServer,
  stopOpenCodeServer,
} from '../../utility/opencode-server-client';
import { syncRemoteConfig } from '../../utility/opencode-client';
import { IpcHandlerDeps } from './types';

export function registerSettingsHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-settings', () => deps.getSettings());

  ipcMain.handle('save-settings', async (_event, settings: AppSettings) => {
    const prev = deps.getSettings();
    const portChanged = settings.port !== prev.port;
    deps.setSettings(settings);
    saveSettings(settings);

    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('settings-changed');
    }

    // Guarded on `app.isPackaged` because unsigned dev builds cause macOS
    // to log `platform_util_mac.mm:260: Operation not permitted` natively,
    // which bypasses the try/catch and spams the dev console. See
    // main/index.ts for the matching startup guard.
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: settings.launchAtLogin,
          openAsHidden: settings.launchAtLogin,
        });
      } catch {
        // Some unsigned packaged configs still throw instead of logging.
      }
    }

    if (portChanged) {
      await stopMcpServer();
      await startMcpServer();
    }

    const openCodeEnabled = settings.agentBackend === 'opencode';

    // startOpenCodeServer / stopOpenCodeServer are async (in-process Server.listen).
    // Swallow rejections so a failing server start never bubbles into the renderer
    // save-settings RPC — the cold-start health probe + logs are the error surface.
    const logOpenCodeError = (action: string) => (err: unknown) => {
      console.error(
        `[settings-handlers] OpenCode ${action} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    };

    if (openCodeEnabled && settings.autoStartOpenCode) {
      if (
        !prev.autoStartOpenCode ||
        settings.openCodePort !== prev.openCodePort
      ) {
        void startOpenCodeServer(settings.openCodePort).catch(
          logOpenCodeError('start'),
        );
      }
    } else if (prev.autoStartOpenCode) {
      void stopOpenCodeServer().catch(logOpenCodeError('stop'));
    }

    if (!openCodeEnabled) {
      void stopOpenCodeServer().catch(logOpenCodeError('stop'));
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
