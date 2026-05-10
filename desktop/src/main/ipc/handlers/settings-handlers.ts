import { app, ipcMain } from 'electron';
import { AppSettings, saveSettings, loadSettings } from '../../settings';
import { startMcpServer, stopMcpServer } from '../../utility/mcp-server-client';
import {
  startOpenCodeServer,
  stopOpenCodeServer,
} from '../../opencode/server-facade';
import { syncRemoteConfig } from '../../utility/opencode-client';
import { IpcHandlerDeps } from './types';

export function registerSettingsHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-settings', () => deps.getSettings());

  /**
   * Returns the actually-bound MCP and OpenCode ports alongside the
   * user-requested values from disk. May differ when the resolver had to
   * probe upward (e.g. another Eden instance occupies the configured
   * port). Renderer surfaces these read-only under the port inputs so
   * users can see what's actually live.
   *
   * Source of truth:
   *   - requested: read fresh from disk via `loadSettings()` so the user
   *     sees the value they configured. We never patch the on-disk hint
   *     port — `currentSettings` reflects only what was loaded/saved by
   *     the user.
   *   - resolved: `deps.getResolvedPorts()` — held in a separate
   *     `resolvedPorts` module-level state in `main/index.ts`, populated
   *     by `startMcpServer`/`startOpenCodeServer` and the supervisor
   *     `onPortResolved` callback. Falls back to the on-disk hint when
   *     the resolver hasn't run yet.
   */
  ipcMain.handle('get-resolved-ports', () => {
    const onDisk = loadSettings();
    const resolved = deps.getResolvedPorts();
    return {
      mcpRequestedPort: onDisk.port,
      mcpResolvedPort: resolved.mcp ?? onDisk.port,
      openCodeRequestedPort: onDisk.openCodePort,
      openCodeResolvedPort: resolved.openCode ?? onDisk.openCodePort,
    };
  });

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
      const resolvedMcp = await startMcpServer();
      deps.setResolvedPort(
        'mcp',
        typeof resolvedMcp === 'number' ? resolvedMcp : null,
      );
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
        void startOpenCodeServer(settings.openCodePort)
          .then((resolvedPort) => {
            deps.setResolvedPort('openCode', resolvedPort);
          })
          .catch(logOpenCodeError('start'));
      }
    } else if (prev.autoStartOpenCode) {
      void stopOpenCodeServer()
        .then(() => deps.setResolvedPort('openCode', null))
        .catch(logOpenCodeError('stop'));
    }

    if (!openCodeEnabled) {
      void stopOpenCodeServer()
        .then(() => deps.setResolvedPort('openCode', null))
        .catch(logOpenCodeError('stop'));
    }

    if (openCodeEnabled && settings.autoSyncOpencode) {
      const timeoutChanged =
        settings.promptTimeoutSeconds !== prev.promptTimeoutSeconds;
      const justEnabled = !prev.autoSyncOpencode;
      if (timeoutChanged || justEnabled || portChanged) {
        // Use the freshly-resolved MCP port (may differ from the user's
        // hint when the resolver probed upward) so opencode.json points
        // at the actually-bound HTTP endpoint.
        const effectiveMcpPort = deps.getResolvedPorts().mcp ?? settings.port;
        syncRemoteConfig(effectiveMcpPort, settings.promptTimeoutSeconds);
      }
    }
    return true;
  });
}
