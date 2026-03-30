import { app, BrowserWindow, Tray } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { startMcpServer, stopMcpServer } from './mcp-server';
import { initDatabase } from './database';
import { defaultSettings, loadSettings, type AppSettings } from './settings';
import { createWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;
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
  );

  mainWindow = createWindow(() => isQuitting);
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
  stopMcpServer();
});

// Export for IPC access
export { mainWindow };
