import { app, BrowserWindow, Tray } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import {
  startMcpServer,
  stopMcpServer,
  getActiveMcpSessionCount,
} from './mcp-server';
import { initDatabase } from './database';
import { defaultSettings, loadSettings, type AppSettings } from './settings';
import { createWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import {
  startSessionTreeManager,
  stopSessionTreeManager,
} from './session-tree-manager';
import { reconcileSessionConnections } from './session-reconnect';
import { startOpenCodeServer, stopOpenCodeServer } from './opencode-server';
import { syncRemoteConfig } from './opencode-config-sync';
import { registerMcpWithRetry } from './opencode-mcp-register';
import { startAutoRegisterWithOpenCode } from './opencode-auto-register';

let mainWindow: BrowserWindow | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray: Tray | null = null;
let isQuitting = false;
let currentSettings: AppSettings = defaultSettings;
let stopAutoRegisterLoop: (() => void) | null = null;

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
  );

  // Register with OpenCode via POST /mcp (primary method — no config file needed)
  const regResult = await registerMcpWithRetry({
    appPort: currentSettings.port,
    openCodePort: currentSettings.openCodePort,
  });
  console.log(
    `[mcp-register] ${regResult.status}${regResult.error ? ` (${regResult.error})` : ''}`,
  );

  // Keep trying in the background so if OpenCode MCP is toggled off/on later,
  // desktop re-registers automatically without manual action.
  stopAutoRegisterLoop = startAutoRegisterWithOpenCode({
    getAppPort: () => currentSettings.port,
    getOpenCodePort: () => currentSettings.openCodePort,
    shouldAttempt: () => getActiveMcpSessionCount() === 0,
  });

  // Sync remote MCP entry into opencode.json as fallback
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
  stopAutoRegisterLoop?.();
  stopAutoRegisterLoop = null;
  stopSessionTreeManager();
  stopOpenCodeServer();
  stopMcpServer();
});

// Export for IPC access
export { mainWindow };
