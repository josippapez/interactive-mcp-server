import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { AppSettings, saveSettings } from './settings';
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
  closeSessionByConnectionId,
} from './mcp-server';
import { indexFiles, rankFileSuggestions } from './file-indexer';
import { forceTerminateChat } from './ipc-prompt';
import { markConnectionDeleted } from './tools/connection-guard';

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

  // File dialog for attachments
  ipcMain.handle('open-file-dialog', async () => {
    const win = deps.getMainWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images & Text',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'svg',
            'bmp',
            'txt',
            'md',
            'json',
            'ts',
            'tsx',
            'js',
            'jsx',
            'css',
            'html',
            'yml',
            'yaml',
            'toml',
            'xml',
            'csv',
            'log',
            'sh',
            'bash',
            'py',
            'rb',
            'go',
            'rs',
            'java',
            'c',
            'cpp',
            'h',
          ],
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
  // Uses noReply:true so the message is visible in the session log but does not trigger an agent response (no premium request cost).
  // Attachments are saved to temp files and referenced by path in the message text (same approach as the TUI version).
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
      const port = deps.getSettings().openCodePort;
      const url = `http://localhost:${port}/session/${encodeURIComponent(data.openCodeSessionId)}/message`;

      // Build the full message text: start with the user's message, then append
      // attachment references as file paths (images saved to temp, text inlined).
      let fullText = data.message;
      for (const att of data.attachments ?? []) {
        if (att.mimeType.startsWith('image/')) {
          // Save image to a temp file and reference by path
          const ext =
            att.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
          const tempPath = join(
            tmpdir(),
            `imcp-attachment-${randomUUID()}.${ext}`,
          );
          try {
            writeFileSync(tempPath, Buffer.from(att.data, 'base64'));
            fullText += `\n\n[Image file: ${tempPath}]`;
          } catch {
            // If we can't write the temp file, skip this attachment
          }
        } else {
          // Text file: inline the content
          fullText += `\n\n--- File: ${att.name} ---\n${att.data}`;
        }
      }

      const parts: { type: 'text'; text: string }[] = [
        { type: 'text', text: fullText },
      ];

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noReply: true, parts }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          return {
            ok: false,
            error: `OpenCode API returned ${res.status}: ${body}`,
          };
        }
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );
}
