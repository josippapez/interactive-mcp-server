import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import JSZip from 'jszip';
import { AppSettings, saveSettings } from './settings';
import {
  injectOpenCodeMessage,
  SUPPORTED_FILE_EXTENSIONS,
} from './opencode-injector';
import { autoDetectOpenCodeSessionId } from './opencode-session';
import { resolveSession, reResolveStaleSession } from './session-resolver';
import {
  getConversationHistory,
  clearHistory,
  queueSessionMessage,
  getActiveSessionChannels,
  getSessionChannelHistory,
  clearSessionChannelMessages,
  deleteSessionChannel,
  deleteRegisteredConnection,
  getRegisteredConnection,
  resetDatabase,
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
} from './database';
import { searchDocs } from './doc-context-injector';
import { handleInjectDocContext } from './inject-doc-context-handler';
import {
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  softRestartMcpServer,
  closeSessionByConnectionId,
} from './mcp-server';
import { indexFiles, rankFileSuggestions } from './file-indexer';
import { forceTerminateChat, getActivePromptData } from './ipc-prompt';
import { markConnectionDeleted } from './tools/connection-guard';
import {
  triggerSessionTreeUpdate,
  tombstoneOpenCodeSession,
  refreshSessionTreeCache,
} from './session-tree-manager';
import { startOpenCodeServer, stopOpenCodeServer } from './opencode-server';
import { syncRemoteConfig } from './opencode-config-sync';
import { registerMcpWithOpenCode } from './opencode-mcp-register';
import { removePersistedSession } from './remove-persisted-session';
import { getBackendAdapter } from './backend-adapter';
import { injectClaudeMessageForConnection } from './claude-sdk-runtime';

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

  ipcMain.handle('reset-database', async () => {
    const result = resetDatabase();
    const win = deps.getMainWindow();
    win?.webContents.send('database-reset', result);
    return result;
  });

  ipcMain.handle('get-server-status', () => {
    return { running: true, port: deps.getSettings().port };
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-provider-status', async () => {
    const settings = deps.getSettings();
    const adapter = await getBackendAdapter(settings.agentBackend);
    const effectiveMode =
      settings.agentBackend === 'claude_sdk' &&
      !adapter.supportsProviderInjection
        ? 'standalone_compat'
        : settings.agentBackend;

    return {
      backend: settings.agentBackend,
      effectiveMode,
      supportsSessionHierarchy: adapter.supportsSessionHierarchy,
      supportsProviderInjection: adapter.supportsProviderInjection,
      runtime: adapter.runtime,
    };
  });

  // Manually trigger MCP registration + config sync into OpenCode
  ipcMain.handle('sync-opencode-config', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return 'skipped: agentBackend is not opencode';
    }
    // Try dynamic registration first
    const regResult = await registerMcpWithOpenCode({
      appPort: settings.port,
      openCodePort: settings.openCodePort,
      promptTimeoutSeconds: settings.promptTimeoutSeconds,
    });
    // Also update config file as fallback
    const syncResult = syncRemoteConfig(
      settings.port,
      settings.promptTimeoutSeconds,
    );
    return `register=${regResult.status}, config=${syncResult}`;
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

  // Provider-agnostic session resolution: maps connectionId → provider session ID.
  // Uses cached DB data first, then one re-resolve attempt if missing.
  ipcMain.handle(
    'resolve-session',
    async (_event, data: { connectionId: string; baseDirectory?: string }) => {
      const settings = deps.getSettings();
      return resolveSession({
        connectionId: data.connectionId,
        backend: settings.agentBackend,
        openCodePort: settings.openCodePort,
        baseDirectory: data.baseDirectory,
      });
    },
  );

  // Re-resolve a stale provider session (clears cache, retries once).
  // Call this after an injection failure suggests the session is gone.
  ipcMain.handle(
    're-resolve-session',
    async (_event, data: { connectionId: string; baseDirectory?: string }) => {
      const settings = deps.getSettings();
      return reResolveStaleSession({
        connectionId: data.connectionId,
        backend: settings.agentBackend,
        openCodePort: settings.openCodePort,
        baseDirectory: data.baseDirectory,
      });
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
        () => deps.getSettings().agentBackend,
      );
    }
    // Start/stop OpenCode serve when the toggle or port changes
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
    // Re-sync remote MCP config when the prompt timeout or port changed
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

  // Return all currently-active prompts so the renderer can recover them on restart.
  ipcMain.handle('get-active-prompts', () => getActivePromptData());

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
    return removePersistedSession(sessionId, {
      getWindow: deps.getMainWindow,
      getOpenCodePort: () => deps.getSettings().openCodePort,
      forceTerminateChat,
      closeSessionByConnectionId,
      deleteSessionChannel,
      deleteRegisteredConnection,
      markConnectionDeleted,
      triggerSessionTreeUpdate,
      getRegisteredConnection,
      tombstoneOpenCodeSession,
    });
  });

  // Session channel — user sends a message, persist to SQLite for extension polling
  ipcMain.on(
    'queue-session-message',
    (_event, data: { sessionId: string; message: string }) => {
      queueSessionMessage(data.sessionId, data.message);
    },
  );

  // Inject a message into an OpenCode session via its HTTP API.
  // Always uses noReply:true so the message is visible in the session log
  // but does not trigger an agent response.
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
    ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> => {
      return injectOpenCodeMessage(
        data.openCodeSessionId,
        data.message,
        data.attachments,
        deps.getSettings().openCodePort,
        deps.getSettings().port,
      );
    },
  );

  ipcMain.handle(
    'inject-claude-message',
    async (
      _event,
      data: {
        connectionId: string;
        message: string;
        baseDirectory?: string;
        attachments?: {
          data: string;
          mimeType: string;
          name: string;
          size: number;
        }[];
      },
    ): Promise<{
      ok: boolean;
      sessionId?: string;
      responseText?: string;
      error?: string;
    }> => {
      return injectClaudeMessageForConnection({
        connectionId: data.connectionId,
        message: data.message,
        baseDirectory: data.baseDirectory,
        attachments: data.attachments,
      });
    },
  );

  /**
   * Inject relevant repository documentation context into an OpenCode session
   * immediately before the user's outbound message. This is called from the
   * renderer just before injecting the user message so that docs are present
   * in model context when OpenCode processes the user's request.
   */
  ipcMain.handle(
    'inject-doc-context',
    async (
      _event,
      data: {
        connectionId: string;
        openCodeSessionId: string;
        message: string;
        baseDirectory?: string;
      },
    ): Promise<{ ok: boolean; injectedCount: number; error?: string }> => {
      const settings = deps.getSettings();
      return handleInjectDocContext(
        { ...data, debug: settings.docContextDebug },
        {
          openCodePort: settings.openCodePort,
          getRegisteredConnection,
          searchDocs,
          injectOpenCodeMessage,
          sendAgentMessage: (connectionId, message) => {
            deps.getMainWindow()?.webContents.send('agent-message', {
              connectionId,
              message,
              openCodeSessionId:
                getRegisteredConnection(connectionId)?.openCodeSessionId ??
                null,
            });
          },
        },
      );
    },
  );

  // ─── Skills & Instructions CRUD ──────────────────────────────────────────

  ipcMain.handle(
    'upsert-skill-or-instruction',
    (
      _event,
      data: {
        name: string;
        type: 'skill' | 'instruction';
        description: string;
        content: string;
      },
    ) => {
      const result = upsertSkillOrInstruction(data);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return result;
    },
  );

  ipcMain.handle(
    'list-skills-and-instructions',
    (_event, filterType?: 'skill' | 'instruction') => {
      return listSkillsAndInstructions(filterType);
    },
  );

  ipcMain.handle('get-skill-or-instruction', (_event, name: string) => {
    return getSkillOrInstructionByName(name);
  });

  ipcMain.handle('delete-skill-or-instruction', (_event, name: string) => {
    const deleted = deleteSkillOrInstruction(name);
    if (deleted) {
      deps.getMainWindow()?.webContents.send('skills-updated');
    }
    return deleted;
  });

  // ─── Export skills & instructions as ZIP ─────────────────────────────────

  ipcMain.handle(
    'export-skills-markdown',
    async (): Promise<{ saved: boolean; filePath?: string }> => {
      const win = deps.getMainWindow();
      if (!win) return { saved: false };

      const result = await dialog.showSaveDialog(win, {
        title: 'Export Skills & Instructions',
        defaultPath: 'skills-and-instructions.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };

      const entries = listSkillsAndInstructions();
      const skills = entries.filter((e) => e.type === 'skill');
      const instructions = entries.filter((e) => e.type === 'instruction');

      const zip = new JSZip();
      const skillsFolder = zip.folder('skills');
      for (const entry of skills) {
        skillsFolder?.file(`${entry.name}.md`, entry.content);
      }
      const instructionsFolder = zip.folder('instructions');
      for (const entry of instructions) {
        instructionsFolder?.file(`${entry.name}.md`, entry.content);
      }

      const readmeLines = [
        '# Skills & Instructions',
        '',
        `Exported on ${new Date().toISOString()}`,
        '',
      ];
      if (skills.length > 0) {
        readmeLines.push('## Skills', '');
        for (const e of skills) {
          readmeLines.push(`- **${e.name}** — ${e.description}`);
        }
        readmeLines.push('');
      }
      if (instructions.length > 0) {
        readmeLines.push('## Instructions', '');
        for (const e of instructions) {
          readmeLines.push(`- **${e.name}** — ${e.description}`);
        }
        readmeLines.push('');
      }
      zip.file('README.md', readmeLines.join('\n'));

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      writeFileSync(result.filePath, buffer);
      return { saved: true, filePath: result.filePath };
    },
  );

  // ─── Export single skill / instruction as Markdown ────────────────────────

  ipcMain.handle(
    'export-single-skill',
    async (
      _event,
      name: string,
    ): Promise<{ saved: boolean; filePath?: string }> => {
      const win = deps.getMainWindow();
      if (!win) return { saved: false };

      const entry = getSkillOrInstructionByName(name);
      if (!entry) return { saved: false };

      const result = await dialog.showSaveDialog(win, {
        title: `Export ${entry.name}`,
        defaultPath: `${entry.name}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };

      writeFileSync(result.filePath, entry.content, 'utf-8');
      return { saved: true, filePath: result.filePath };
    },
  );

  // ─── Refresh session tree cache on demand ────────────────────────────────

  ipcMain.handle('refresh-session-tree', async () => {
    await refreshSessionTreeCache();
  });

  // ─── Permission reply — forward agent decision to OpenCode ───────────────

  ipcMain.handle(
    'reply-permission',
    async (
      _event,
      data: {
        sessionID: string;
        requestID: string;
        reply: 'once' | 'always' | 'reject';
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      const { openCodePort } = deps.getSettings();
      const url = `http://localhost:${openCodePort}/session/${data.sessionID}/permission/${data.requestID}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reply: data.reply }),
        });
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
        }
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  );
}
