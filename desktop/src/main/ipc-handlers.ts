import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { AppSettings, saveSettings } from './settings';
import {
  injectOpenCodeMessage,
  SUPPORTED_FILE_EXTENSIONS,
} from './opencode-injector';
import { autoDetectOpenCodeSessionId } from './opencode-session';
import {
  getConversationHistory,
  clearHistory,
  queueSessionMessage,
  getActiveSessionChannels,
  getSessionChannelHistory,
  clearSessionChannelMessages,
  deleteSessionChannel,
  deleteRegisteredConnection,
} from './database';
import {
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  softRestartMcpServer,
  closeSessionByConnectionId,
} from './mcp-server';
import { indexFiles, rankFileSuggestions } from './file-indexer';
import { forceTerminateChat } from './ipc-prompt';
import { markConnectionDeleted } from './tools/connection-guard';
import { triggerSessionTreeUpdate } from './session-tree-manager';
import { startOpenCodeServer, stopOpenCodeServer } from './opencode-server';
import { resolveBridgePath, MCP_CONFIG_FILE } from './session-file';

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

  ipcMain.handle('get-app-version', () => app.getVersion());

  // Return the bridge script path and MCP config file location
  ipcMain.handle('get-bridge-info', () => {
    return {
      bridgePath: resolveBridgePath(),
      mcpConfigFile: MCP_CONFIG_FILE,
    };
  });

  // Detect the active OpenCode session on demand (best-effort, used for lazy injection)
  ipcMain.handle(
    'detect-opencode-session',
    async (_event, baseDirectory?: string): Promise<string | null> => {
      return autoDetectOpenCodeSessionId(
        deps.getSettings().openCodePort,
        baseDirectory,
      );
    },
  );

  ipcMain.handle('get-settings', () => deps.getSettings());

  ipcMain.handle('save-settings', (_event, settings: AppSettings) => {
    const prev = deps.getSettings();
    const portChanged = settings.port !== prev.port;
    deps.setSettings(settings);
    saveSettings(settings);
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      openAsHidden: settings.launchAtLogin,
    });
    // Restart server if port changed
    if (portChanged) {
      stopMcpServer();
      startMcpServer(
        settings.port,
        deps.getMainWindow,
        () => deps.getSettings().soundEnabled,
        () => deps.getSettings().promptTimeoutSeconds * 1000,
        () => deps.getSettings().openCodePort,
        () => deps.getSettings().docIndexingEnabled,
      );
    }
    // Start/stop OpenCode serve when the toggle or port changes
    if (settings.autoStartOpenCode) {
      if (
        !prev.autoStartOpenCode ||
        settings.openCodePort !== prev.openCodePort
      ) {
        startOpenCodeServer(settings.openCodePort);
      }
    } else if (prev.autoStartOpenCode) {
      stopOpenCodeServer();
    }
    return true;
  });

  // Soft-restart: clear all in-memory MCP sessions but keep the HTTP listener
  // running so clients can transparently reinitialize on their next request.
  ipcMain.handle('reconnect-mcp-server', async () => {
    const cleared = await softRestartMcpServer();
    return { ok: true, cleared };
  });

  ipcMain.handle(
    'search-files',
    async (_event, baseDirectory: string, query: string) => {
      const files = await indexFiles(baseDirectory);
      return rankFileSuggestions(files, query, 50);
    },
  );

  // File dialog for attachments
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

  // Read file contents for attachment
  ipcMain.handle('read-file-for-attachment', (_event, filePath: string) => {
    try {
      const buffer = readFileSync(filePath);
      const name = basename(filePath);
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
      const isImage = imageExts.includes(ext);

      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      };

      if (isImage) {
        return {
          type: 'image' as const,
          data: buffer.toString('base64'),
          mimeType: mimeMap[ext] || 'application/octet-stream',
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

  // Force-terminate a chat connection from the UI
  ipcMain.handle('force-terminate-chat', (_event, connectionId: string) => {
    forceTerminateChat(connectionId);
  });

  // Dismiss a session tab: cancel any pending prompt with "No reply" and remove the connection from the UI
  ipcMain.handle('dismiss-session', (_event, connectionId: string) => {
    forceTerminateChat(connectionId);
    const win = deps.getMainWindow();
    win?.webContents.send('connection-closed', { connectionId });
  });

  // Restart the MCP server (reconnect all clients)
  ipcMain.handle('restart-mcp-server', async () => {
    await restartMcpServer();
    return true;
  });

  // Return persisted session channels for UI restoration on startup
  ipcMain.handle('get-persisted-session-channels', () =>
    getActiveSessionChannels(),
  );
  ipcMain.handle('get-session-channel-history', (_event, sessionId: string) =>
    getSessionChannelHistory(sessionId),
  );
  ipcMain.handle(
    'clear-session-channel-messages',
    (_event, sessionId: string) => {
      clearSessionChannelMessages(sessionId);
      deps
        .getMainWindow()
        ?.webContents.send('session-channel-messages-cleared', { sessionId });
      return true;
    },
  );
  ipcMain.handle('remove-session-channel', (_event, sessionId: string) => {
    forceTerminateChat(sessionId);
    void closeSessionByConnectionId(sessionId);
    deleteSessionChannel(sessionId);
    deleteRegisteredConnection(sessionId);
    markConnectionDeleted(sessionId);
    void triggerSessionTreeUpdate(
      deps.getMainWindow,
      () => deps.getSettings().openCodePort,
    );
    deps.getMainWindow()?.webContents.send('connection-closed', {
      connectionId: sessionId,
    });
    deps.getMainWindow()?.webContents.send('session-channel-deleted', {
      sessionId,
    });
    return true;
  });

  // Session channel — user sends a message, persist to SQLite for extension polling
  ipcMain.on(
    'queue-session-message',
    (_event, data: { sessionId: string; message: string }) => {
      queueSessionMessage(data.sessionId, data.message);
    },
  );

  // Inject a message into an OpenCode session via its HTTP API.
  // When noReplyInjection is true (Settings), uses noReply:true so the message
  // is visible in the session log but does not trigger an agent response.
  // Default (noReplyInjection=false) triggers a real agent response.
  ipcMain.handle(
    'inject-opencode-message',
    async (
      _event,
      data: {
        openCodeSessionId: string;
        message: string;
        attachments?: {
          data: string;
          mimeType: string;
          name: string;
          size: number;
        }[];
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      return injectOpenCodeMessage(
        data.openCodeSessionId,
        data.message,
        data.attachments,
        deps.getSettings().openCodePort,
        deps.getSettings().noReplyInjection,
      );
    },
  );
}
