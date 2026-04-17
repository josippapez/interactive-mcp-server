import { app, BrowserWindow, Tray } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { startMcpServer, stopMcpServer } from './mcp-server';
import { initDatabase, seedBuiltinTemplates } from './database';
import { defaultSettings, loadSettings, type AppSettings } from './settings';
import { createWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc/handlers';
import {
  startSessionTreeManager,
  stopSessionTreeManager,
  replayPendingSessionTreeSnapshot,
} from './session/tree-manager';
import {
  startBusEventSubscription,
  stopBusEventSubscription,
} from './opencode/bus-events';
import { reconcileSessionConnections } from './session/reconnect';
import { startOpenCodeServer, stopOpenCodeServer } from './opencode/server';
import { syncRemoteConfig } from './opencode/config-sync';
import { detectClaudeSdkRuntime } from './claude-sdk-runtime';
import { registerMcpWithRetry } from './opencode/mcp-register';
import { BUILTIN_TEMPLATES } from './builtin-templates';
import { initLogger, createLogger } from './utils/logger';
import {
  initializeConversationProviders,
  stopConversationProviders,
  registerConversationHandlers,
  updateConversationPort,
} from './conversation';
import { shutdown as shutdownDocIndexer } from './docs/indexer';

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

  // =====================================================================
  // CRITICAL PATH — must complete before the renderer connects via IPC.
  // Keep this section as small and fast as possible.
  // =====================================================================

  // Initialize file logger first so everything else can log.
  initLogger(app.getPath('logs'));
  const appLog = createLogger('app');
  appLog.info(`Application started, version=${app.getVersion()}`);

  // Database init is required here because many IPC handlers (sidebar,
  // templates, session history) read from the DB immediately on renderer
  // load. sql.js init is fast (<50ms typical).
  await initDatabase();

  // Settings are required to pass `startHidden` to createWindow.
  currentSettings = loadSettings();

  // Register IPC handlers BEFORE the window loads so the renderer's
  // immediate IPC calls don't race with handler registration.
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getSettings: () => currentSettings,
    setSettings: (settings: AppSettings) => {
      // Track if OpenCode port changed for conversation provider update
      const portChanged =
        settings.openCodePort !== currentSettings.openCodePort;
      currentSettings = settings;
      // Update conversation provider port if it changed
      if (portChanged) {
        updateConversationPort(settings.openCodePort);
      }
    },
  });
  registerConversationHandlers();

  // =====================================================================
  // Create window + tray as early as possible so the user sees UI fast.
  // =====================================================================

  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  mainWindow = createWindow(() => isQuitting, {
    startHidden: openedAtLogin,
  });
  replayPendingSessionTreeSnapshot(() => mainWindow);
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

  // =====================================================================
  // DEFERRED INITIALIZATION — runs after the window's first paint.
  //
  // Everything below is non-essential for the renderer to mount its UI.
  // Running it after `ready-to-show` means users see the window before
  // we start the MCP server, probe OpenCode, etc.
  // =====================================================================

  const runDeferredInit = async () => {
    // Set login item settings (may fail in development or without proper signing)
    try {
      app.setLoginItemSettings({
        openAtLogin: currentSettings.launchAtLogin,
        openAsHidden: currentSettings.launchAtLogin,
      });
    } catch {
      // Login item registration requires app signing on macOS
      // Silently ignore in development
    }

    // Seed built-in templates on first launch (only inserts if not already present)
    const seededCount = seedBuiltinTemplates(BUILTIN_TEMPLATES);
    if (seededCount > 0) {
      console.log(
        `[builtin-templates] Seeded ${seededCount} built-in templates`,
      );
    }

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

      // Auto-start OpenCode serve before session probing/reconcile so cold-start
      // startup does not waste time probing a dead instance first.
      if (currentSettings.autoStartOpenCode) {
        startOpenCodeServer(currentSettings.openCodePort);
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
        () => currentSettings,
      );

      // Reconcile persisted connections with live OpenCode sessions
      const reconResult = await reconcileSessionConnections(
        currentSettings.openCodePort,
      );
      console.log(
        `[session-reconnect] matched=${reconResult.matched} cleaned=${reconResult.cleaned} total=${reconResult.total}`,
      );

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

      // Initialize conversation providers for mirroring OpenCode conversations
      initializeConversationProviders({
        getMainWindow: () => mainWindow,
        getOpenCodePort: () => currentSettings.openCodePort,
      });
    } else if (currentSettings.agentBackend === 'claude_sdk') {
      const claudeRuntime = await detectClaudeSdkRuntime();
      console.log(`[claude-sdk] ${claudeRuntime.message}`);
    }
  };

  // Run deferred work after the window is ready to paint. `ready-to-show`
  // fires even when the window is kept hidden (launch-at-login case), so
  // this path still runs. Fallback to setImmediate if the window somehow
  // doesn't exist (shouldn't happen, but defensive).
  let deferredStarted = false;
  const startDeferredOnce = () => {
    if (deferredStarted) return;
    deferredStarted = true;
    setImmediate(() => {
      void runDeferredInit().catch((err) => {
        appLog.error(`Deferred init failed: ${String(err)}`);
      });
    });
  };

  if (mainWindow) {
    mainWindow.once('ready-to-show', startDeferredOnce);
    // Safety net: if ready-to-show never fires (e.g. renderer load failure),
    // kick off deferred init after a short delay so the MCP server still
    // comes up.
    setTimeout(startDeferredOnce, 3000);
  } else {
    setImmediate(startDeferredOnce);
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitCleanupStarted = false;

app.on('before-quit', (event) => {
  // Synchronous cleanup is safe to call every time (idempotent).
  isQuitting = true;
  stopSessionTreeManager();
  stopBusEventSubscription();
  stopConversationProviders();
  stopOpenCodeServer();
  stopMcpServer();

  // Async cleanup: defer the real quit until the embedding worker has
  // fully terminated. Re-entrancy guard ensures we only kick this off once;
  // the second before-quit (after app.quit()) falls through cleanly.
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  event.preventDefault();

  void shutdownDocIndexer()
    .catch((err) => {
      console.error('[main] doc indexer shutdown failed:', err);
    })
    .finally(() => {
      app.quit();
    });
});

// Export for IPC access
export { mainWindow };
