import { app, BrowserWindow, Tray } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { startMcpServer, stopMcpServer } from './mcp-server';
import { initDatabase } from './database';
import { defaultSettings, loadSettings, type AppSettings } from './settings';
import { createWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import {
  startSessionTreeManager,
  stopSessionTreeManager,
} from './session-tree-manager';
import {
  startBusEventSubscription,
  stopBusEventSubscription,
} from './opencode-bus-events';
import { reconcileSessionConnections } from './session-reconnect';
import { startOpenCodeServer, stopOpenCodeServer } from './opencode-server';
import { syncRemoteConfig } from './opencode-config-sync';
import { detectClaudeSdkRuntime } from './claude-sdk-runtime';
import { registerMcpWithRetry } from './opencode-mcp-register';

let mainWindow: BrowserWindow | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray: Tray | null = null;
let isQuitting = false;
let currentSettings: AppSettings = defaultSettings;

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.interactive-mcp.desktop');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Initialize database and load settings
  await initDatabase();
  currentSettings = loadSettings();
  app.setLoginItemSettings({
    openAtLogin: currentSettings.launchAtLogin,
    openAsHidden: currentSettings.launchAtLogin,
  });

  // Register IPC handlers
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getSettings: () => currentSettings,
    setSettings: (settings: AppSettings) => {
      currentSettings = settings;
    },
  });

  // Start MCP server (pass getter so it always has the current window)
  await startMcpServer(
    currentSettings.port,
    () => mainWindow,
    () => currentSettings.soundEnabled,
    () => currentSettings.promptTimeoutSeconds * 1000,
    () => currentSettings.openCodePort,
    () => currentSettings.docIndexingEnabled,
    () => currentSettings.agentBackend,
  );

  const isOpenCodeBackend = currentSettings.agentBackend === 'opencode';
  if (isOpenCodeBackend) {
    // Sync remote MCP entry into opencode.json on startup
    // Registration with OpenCode must be triggered manually via the
    // "Register provider config" button in Settings after OpenCode restarts.
    if (currentSettings.autoSyncOpencode) {
      const syncResult = syncRemoteConfig(
        currentSettings.port,
        currentSettings.promptTimeoutSeconds,
      );
      console.log(`[config-sync] ${syncResult}`);
    }

    // Start session-tree sync (replaces old poller)
    startSessionTreeManager(
      () => mainWindow,
      () => currentSettings.openCodePort,
      () => currentSettings.autoRegisterSubagents,
    );

    // Subscribe to the OpenCode global-event bus (session.status, permission.*)
    startBusEventSubscription(
      () => mainWindow,
      () => currentSettings.openCodePort,
    );

    // Reconcile persisted connections with live OpenCode sessions
    const reconResult = await reconcileSessionConnections(
      currentSettings.openCodePort,
    );
    console.log(
      `[session-reconnect] matched=${reconResult.matched} cleaned=${reconResult.cleaned} total=${reconResult.total}`,
    );

    // Auto-start OpenCode serve if enabled
    if (currentSettings.autoStartOpenCode) {
      startOpenCodeServer(currentSettings.openCodePort);
    }

    // Re-register with OpenCode on every startup so its MCP client performs a
    // fresh initialize handshake instead of hanging on a stale reconnect backoff.
    // This is fire-and-forget with retries — it resolves the Cmd+Q → relaunch
    // hang where activeClients stays 0 because OpenCode's client never completes
    // re-initialization after the previous server instance was killed.
    void registerMcpWithRetry({
      appPort: currentSettings.port,
      openCodePort: currentSettings.openCodePort,
      promptTimeoutSeconds: currentSettings.promptTimeoutSeconds,
    }).then((result) => {
      console.log(
        `[startup-register] status=${result.status}${result.error ? ` error=${result.error}` : ''}`,
      );
    });
  } else if (currentSettings.agentBackend === 'claude_sdk') {
    const claudeRuntime = await detectClaudeSdkRuntime();
    console.log(`[claude-sdk] ${claudeRuntime.message}`);
  }

  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  mainWindow = createWindow(() => isQuitting, {
    startHidden: openedAtLogin,
  });
  tray = createTray(
    () => mainWindow,
    () => {
      isQuitting = true;
      stopMcpServer();
      app.quit();
    },
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(() => isQuitting);
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopSessionTreeManager();
  stopBusEventSubscription();
  stopOpenCodeServer();
  stopMcpServer();
});

// Export for IPC access
export { mainWindow };
