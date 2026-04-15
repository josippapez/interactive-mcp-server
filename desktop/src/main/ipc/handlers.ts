import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import JSZip from 'jszip';
import { AppSettings, saveSettings } from '../settings';
import {
  injectOpenCodeMessage,
  SUPPORTED_FILE_EXTENSIONS,
} from '../opencode/injector';
import {
  autoDetectOpenCodeSessionId,
  createOpenCodeSession,
} from '../opencode/session';
import {
  fetchMcpStatus,
  connectMcp,
  disconnectMcp,
  registerMcp,
} from '../opencode/mcp-status';
import { resolveSession, reResolveStaleSession } from '../session/resolver';
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
  getRegisteredConnectionBySessionId,
  resetDatabase,
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
  toggleSkillOrInstructionEnabled,
  duplicateSkillOrInstruction,
  upsertContextInjection,
  resetBuiltinTemplates,
  getMissingBuiltinCount,
  getPinnedProjects,
  addPinnedProject,
  removePinnedProject,
  updateConnectionBaseDirectory,
} from '../database';
import {
  BUILTIN_TEMPLATES,
  getBuiltinTemplateNames,
} from '../builtin-templates';
import { searchDocs } from '../docs/context-injector';
import { handleInjectDocContext } from '../docs/inject-handler';
import { sendAgentMessage } from './channel';
import {
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  softRestartMcpServer,
  closeSessionByConnectionId,
} from '../mcp-server';
import { indexFiles, rankFileSuggestions } from '../docs/file-indexer';
import { forceTerminateChat, getActivePromptData } from './prompt';
import { markConnectionDeleted } from '../tools/connection-guard';
import {
  triggerSessionTreeUpdate,
  tombstoneOpenCodeSession,
  refreshSessionTreeCache,
} from '../session/tree-manager';
import { startOpenCodeServer, stopOpenCodeServer } from '../opencode/server';
import { syncRemoteConfig } from '../opencode/config-sync';
import { registerMcpAcrossReachablePorts } from '../opencode/mcp-register';
import { removePersistedSession } from '../remove-persisted-session';
import { getBackendAdapter } from '../backend-adapter';
import { fetchTodosForSession } from '../opencode/todo';
import { abortOpenCodeSession } from '../opencode/abort';
import { checkOpenCodeHealth } from '../opencode/health';
import { fetchVcsInfo } from '../opencode/vcs';
import { fetchSessionStatus } from '../opencode/session-status';
import { injectClaudeMessageForConnection } from '../claude-sdk-runtime';
import {
  matchSkillsForMessage,
  buildSkillSuggestionText,
} from '../tools/skill-match';
import { searchGlobal } from '../docs/search';
import {
  getSessionContextUsage,
  triggerCompaction,
  fetchSessionTokens,
  setSessionTotalTokens,
} from '../opencode/context-tracking';
import {
  fetchProviders,
  fetchProvidersInfo,
  fetchModels,
  fetchProviderAuthMethods,
  authorizeProvider,
  callbackProvider,
  setProviderApiKey,
} from '../opencode/provider';
import { fetchCommands, executeCommand } from '../opencode/command';
import { createLogger } from '../utils/logger';

const ipcLog = createLogger('ipc');
const rendererLog = createLogger('renderer');

export interface IpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  getSettings: () => AppSettings;
  setSettings: (settings: AppSettings) => void;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  // ─── Renderer Logging ─────────────────────────────────────────────────────
  // Bridge for renderer process to write logs to the main process log file.
  // This allows routing diagnostics to be persisted alongside other app logs.
  ipcMain.on(
    'renderer-log',
    (
      _event,
      data: {
        level: 'debug' | 'info' | 'warn' | 'error';
        category: string;
        message: string;
      },
    ) => {
      const logFn = rendererLog[data.level] ?? rendererLog.info;
      logFn(`[${data.category}] ${data.message}`);
    },
  );

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
    ipcLog.info(`sync-opencode-config: backend=${settings.agentBackend}`);
    if (settings.agentBackend !== 'opencode') {
      return 'skipped: agentBackend is not opencode';
    }
    // Try dynamic registration first
    const regResult = await registerMcpAcrossReachablePorts({
      appPort: settings.port,
      openCodePort: settings.openCodePort,
      promptTimeoutSeconds: settings.promptTimeoutSeconds,
    });
    // Also update config file as fallback
    const syncResult = syncRemoteConfig(
      settings.port,
      settings.promptTimeoutSeconds,
      settings.extraMcpServers,
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
      ipcLog.info(`resolve-session: connectionId=${data.connectionId}`);
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

    // Notify renderer that settings have changed
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('settings-changed');
    }

    // Set login item settings (may fail in development or without proper signing)
    try {
      app.setLoginItemSettings({
        openAtLogin: settings.launchAtLogin,
        openAsHidden: settings.launchAtLogin,
      });
    } catch {
      // Login item registration requires app signing on macOS
      // Silently ignore in development
    }

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
      const extraServersChanged =
        settings.extraMcpServers !== prev.extraMcpServers;
      if (timeoutChanged || justEnabled || portChanged || extraServersChanged) {
        syncRemoteConfig(
          settings.port,
          settings.promptTimeoutSeconds,
          settings.extraMcpServers,
        );
      }
    }
    return true;
  });

  // Soft-restart: clear all in-memory MCP sessions but keep the HTTP listener
  // running so clients can transparently reinitialize on their next request.
  ipcMain.handle('reconnect-mcp-server', async () => {
    ipcLog.info('reconnect-mcp-server: soft restart requested');
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

  // Folder dialog for adding project folders
  ipcMain.handle('open-folder-dialog', async () => {
    const win = deps.getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
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

  // Pinned projects management
  ipcMain.handle('get-pinned-projects', () => getPinnedProjects());

  ipcMain.handle(
    'add-pinned-project',
    (_event, data: { path: string; name: string }) => {
      return addPinnedProject(data.path, data.name);
    },
  );

  ipcMain.handle('remove-pinned-project', (_event, path: string) => {
    return removePinnedProject(path);
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
      ipcLog.info(
        `[queue-session-message] sessionId=${data.sessionId} messageLength=${data.message.length}`,
      );
      const skills = listSkillsAndInstructions('skill');
      const matched = matchSkillsForMessage(data.message, skills);
      const suggestion = buildSkillSuggestionText(matched);
      const outbound = suggestion
        ? `${suggestion}\n\n${data.message}`
        : data.message;
      queueSessionMessage(data.sessionId, outbound);
      ipcLog.info(
        `[queue-session-message] queued to sessionId=${data.sessionId}`,
      );
    },
  );

  // Inject a message into an OpenCode session via its HTTP API.
  // By default uses noReply:true so the message is visible in the session log
  // but does not trigger an agent response. Set noReply:false to trigger a reply.
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
        noReply?: boolean;
        modelOverride?: {
          providerId: string;
          modelId: string;
          variant?: string;
        };
      },
    ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> => {
      ipcLog.info(
        `[inject-opencode-message] openCodeSessionId=${data.openCodeSessionId} noReply=${data.noReply ?? true} messageLength=${data.message.length} attachments=${data.attachments?.length ?? 0}`,
      );
      const skills = listSkillsAndInstructions('skill');
      const matched = matchSkillsForMessage(data.message, skills);
      const suggestion = buildSkillSuggestionText(matched);
      const outbound = suggestion
        ? `${suggestion}\n\n${data.message}`
        : data.message;
      const result = await injectOpenCodeMessage(
        data.openCodeSessionId,
        outbound,
        data.attachments,
        deps.getSettings().openCodePort,
        deps.getSettings().port,
        data.noReply ?? true,
        data.modelOverride,
      );
      ipcLog.info(
        `[inject-opencode-message] result ok=${result.ok} error=${result.error ?? 'none'} openCodeSessionId=${data.openCodeSessionId}`,
      );
      return result;
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
        openCodeSessionId: string | null;
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
          upsertContextInjection,
          sendAgentMessage: (connectionId, openCodeSessionId, message) => {
            // Use the centralized IPC channel abstraction
            sendAgentMessage(
              deps.getMainWindow(),
              connectionId,
              openCodeSessionId,
              message,
            );
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
        category?: string | null;
        tags?: string[] | null;
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
    (
      _event,
      params?: {
        filterType?: 'skill' | 'instruction';
        filterCategory?: string;
      },
    ) => {
      return listSkillsAndInstructions(
        params?.filterType,
        params?.filterCategory,
      );
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

  ipcMain.handle(
    'toggle-skill-or-instruction-enabled',
    (_event, data: { name: string; enabled: boolean }) => {
      const result = toggleSkillOrInstructionEnabled(data.name, data.enabled);
      if (result) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return result;
    },
  );

  ipcMain.handle('duplicate-skill-or-instruction', (_event, name: string) => {
    const result = duplicateSkillOrInstruction(name);
    if (result) {
      deps.getMainWindow()?.webContents.send('skills-updated');
    }
    return result;
  });

  // ─── Built-in templates management ─────────────────────────────────────────

  ipcMain.handle(
    'reset-builtin-templates',
    (): { resetCount: number; templateNames: string[] } => {
      const resetCount = resetBuiltinTemplates(BUILTIN_TEMPLATES);
      if (resetCount > 0) {
        deps.getMainWindow()?.webContents.send('skills-updated');
      }
      return {
        resetCount,
        templateNames: getBuiltinTemplateNames(),
      };
    },
  );

  ipcMain.handle(
    'get-missing-builtin-count',
    (): { missingCount: number; totalBuiltins: number } => {
      const templateNames = getBuiltinTemplateNames();
      const missingCount = getMissingBuiltinCount(templateNames);
      return {
        missingCount,
        totalBuiltins: templateNames.length,
      };
    },
  );

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
    const settings = deps.getSettings();
    if (settings.agentBackend === 'opencode') {
      await registerMcpAcrossReachablePorts({
        appPort: settings.port,
        openCodePort: settings.openCodePort,
        promptTimeoutSeconds: settings.promptTimeoutSeconds,
      });
    }
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
      // Use the newer /permission/:requestID/reply endpoint (not the deprecated session endpoint)
      const url = `http://localhost:${openCodePort}/permission/${data.requestID}/reply`;
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

  // ─── Fetch todos for an OpenCode session ─────────────────────────────────

  ipcMain.handle(
    'fetch-session-todos',
    async (
      _event,
      sessionId: string,
    ): Promise<{
      todos: { content: string; status: string; priority: string }[] | null;
      error?: string;
    }> => {
      const { openCodePort } = deps.getSettings();
      const todos = await fetchTodosForSession(openCodePort, sessionId);
      if (todos === null) {
        return { todos: null, error: 'Failed to fetch todos' };
      }
      return { todos };
    },
  );

  // ─── Abort an OpenCode session ──────────────────────────────────────────────

  ipcMain.handle(
    'abort-session',
    async (
      _event,
      sessionId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      const { openCodePort } = deps.getSettings();
      const success = await abortOpenCodeSession(openCodePort, sessionId);
      if (!success) {
        return { success: false, error: 'Failed to abort session' };
      }
      return { success: true };
    },
  );

  // ─── Create a new OpenCode session ──────────────────────────────────────────

  ipcMain.handle(
    'create-opencode-session',
    async (
      _event,
      data: {
        title?: string;
        parentID?: string;
        initialMessage?: string;
        baseDirectory?: string;
        attachments?: {
          data: string;
          mimeType: string;
          name: string;
          size: number;
        }[];
        modelSelection?: {
          providerId: string;
          modelId: string;
          variant?: string;
        };
      },
    ): Promise<{
      ok: boolean;
      sessionId?: string;
      error?: string;
    }> => {
      ipcLog.info(
        `create-opencode-session: title=${data.title ?? '(none)'} parentID=${data.parentID ?? '(none)'} baseDirectory=${data.baseDirectory ?? '(none)'}`,
      );
      const {
        openCodePort,
        agentBackend,
        port: mcpServerPort,
      } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return {
          ok: false,
          error: `OpenCode backend not enabled (current: ${agentBackend})`,
        };
      }

      const hasAttachments = (data.attachments?.length ?? 0) > 0;
      const hasInitialMessage = (data.initialMessage?.trim().length ?? 0) > 0;
      const hasModelSelection = Boolean(data.modelSelection);

      // Inject path is required when we need capabilities only supported by
      // injectOpenCodeMessage (attachments and/or explicit model selection).
      // Note: attachments-only submissions are valid from the blank new-session page.
      const needsInject =
        (hasAttachments || hasModelSelection) &&
        (hasAttachments || hasInitialMessage);

      ipcLog.info(
        `create-opencode-session flags: hasInitialMessage=${hasInitialMessage} hasAttachments=${hasAttachments} hasModelSelection=${hasModelSelection} needsInject=${needsInject}`,
      );
      if (hasModelSelection) {
        ipcLog.info(
          `create-opencode-session modelSelection: providerId=${data.modelSelection?.providerId ?? '(none)'} modelId=${data.modelSelection?.modelId ?? '(none)'} variant=${data.modelSelection?.variant ?? '(none)'}`,
        );
      }

      const result = await createOpenCodeSession(openCodePort, {
        title: data.title,
        parentID: data.parentID,
        // Only send initial message directly if injection is not required.
        // Skip empty-string messages.
        initialMessage:
          !needsInject && hasInitialMessage ? data.initialMessage : undefined,
        // Pass directory to create session in correct project context
        // This ensures OpenCode loads .opencode/opencode.jsonc and project-specific MCPs
        directory: data.baseDirectory,
      });

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      // If we need to inject (attachments or model selection), use injectOpenCodeMessage
      if (needsInject && result.session?.id) {
        // Build model override from selection if provided
        const modelOverride = data.modelSelection
          ? {
              providerId: data.modelSelection.providerId,
              modelId: data.modelSelection.modelId,
              variant: data.modelSelection.variant,
            }
          : undefined;

        const injectResult = await injectOpenCodeMessage(
          result.session.id,
          data.initialMessage ?? '',
          data.attachments,
          openCodePort,
          mcpServerPort,
          false, // noReply = false to trigger agent response
          modelOverride,
        );

        if (!injectResult.ok) {
          // Session was created but message injection failed
          console.warn(
            `[create-opencode-session] Session created but initial message injection failed: ${injectResult.error}`,
          );
        }
      }

      // Trigger a session tree refresh so the new session appears in the sidebar
      await refreshSessionTreeCache();

      // If a baseDirectory was provided, update the registered connection
      // This overrides the default directory from OpenCode with the user's selection
      if (data.baseDirectory && result.session?.id) {
        updateConnectionBaseDirectory(
          result.session.id,
          data.baseDirectory,
          'opencode',
        );
        // Re-trigger tree update so the sidebar shows the correct project grouping
        await triggerSessionTreeUpdate(deps.getMainWindow);
      }

      return { ok: true, sessionId: result.session?.id };
    },
  );

  // ─── Check OpenCode server health ────────────────────────────────────────────

  ipcMain.handle(
    'check-opencode-health',
    async (): Promise<{
      available: boolean;
      healthy: boolean;
      version: string | null;
      error?: string;
    }> => {
      const { openCodePort, agentBackend } = deps.getSettings();
      // If not using OpenCode backend, return unavailable
      if (agentBackend !== 'opencode') {
        return {
          available: false,
          healthy: false,
          version: null,
          error: `OpenCode backend not enabled (current: ${agentBackend})`,
        };
      }
      return checkOpenCodeHealth(openCodePort);
    },
  );

  // ─── Fetch VCS info from OpenCode ────────────────────────────────────────────

  ipcMain.handle(
    'fetch-vcs-info',
    async (): Promise<{
      branch: string | null;
      defaultBranch: string | null;
    } | null> => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return null;
      }
      return fetchVcsInfo(openCodePort);
    },
  );

  // ─── Fetch session status from OpenCode ─────────────────────────────────────

  ipcMain.handle(
    'fetch-session-status',
    async (): Promise<Record<
      string,
      { type: 'busy' | 'idle' | 'error' | 'unknown' }
    > | null> => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return null;
      }
      return fetchSessionStatus(openCodePort);
    },
  );

  // ─── Global Search ───────────────────────────────────────────────────────────

  ipcMain.handle(
    'search-global',
    (
      _event,
      data: {
        query: string;
        sessionLimit?: number;
        messageLimit?: number;
      },
    ) => {
      return searchGlobal(data.query, {
        sessionLimit: data.sessionLimit,
        messageLimit: data.messageLimit,
      });
    },
  );

  // ─── Allowed Read Folders Management ────────────────────────────────────────

  ipcMain.handle('add-allowed-read-folder', (_event, folderPath: string) => {
    const currentSettings = deps.getSettings();
    const folders = currentSettings.allowedReadFolders ?? [];
    // Avoid duplicates
    if (!folders.includes(folderPath)) {
      const updatedSettings = {
        ...currentSettings,
        allowedReadFolders: [...folders, folderPath],
      };
      deps.setSettings(updatedSettings);
      saveSettings(updatedSettings);
    }
    return { ok: true };
  });

  ipcMain.handle('remove-allowed-read-folder', (_event, folderPath: string) => {
    const currentSettings = deps.getSettings();
    const folders = currentSettings.allowedReadFolders ?? [];
    const updatedSettings = {
      ...currentSettings,
      allowedReadFolders: folders.filter((f) => f !== folderPath),
    };
    deps.setSettings(updatedSettings);
    saveSettings(updatedSettings);
    return { ok: true };
  });

  ipcMain.handle('get-allowed-read-folders', () => {
    const currentSettings = deps.getSettings();
    return currentSettings.allowedReadFolders ?? [];
  });

  ipcMain.handle('select-folder-dialog', async () => {
    const win = deps.getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Folder to Allow',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, folderPath: result.filePaths[0] };
  });

  // ─── Context Tracking IPC Handlers ─────────────────────────────────────────

  ipcMain.handle('get-context-usage', async (_event, sessionId: string) => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') return null;

    const sessionInfo = await fetchSessionTokens(
      sessionId,
      settings.openCodePort,
    );
    if (!sessionInfo) return null;

    // Always recompute from the latest OpenCode session snapshot instead of
    // returning potentially stale cached usage. This keeps parent/child context
    // bars updating regularly rather than freezing after the first calculation.
    return setSessionTotalTokens(
      sessionId,
      sessionInfo.tokens ?? 0,
      sessionInfo.modelId,
      sessionInfo.providerId,
    );
  });

  ipcMain.handle(
    'trigger-compaction',
    async (
      _event,
      {
        sessionId,
        providerId,
        modelId,
      }: { sessionId: string; providerId?: string; modelId?: string },
    ) => {
      const settings = deps.getSettings();
      ipcLog.info(`trigger-compaction: sessionId=${sessionId}`);
      console.log(
        '[trigger-compaction] Starting compaction for session:',
        sessionId,
      );

      // If providerId or modelId not provided, get defaults from OpenCode API
      let finalProviderId = providerId;
      let finalModelId = modelId;

      if (!finalProviderId || !finalModelId) {
        const providersInfo = await fetchProvidersInfo(settings.openCodePort);
        if (providersInfo) {
          // Get the first connected provider and its default model
          const connectedProvider = providersInfo.connectedProviderIds[0];
          if (connectedProvider) {
            finalProviderId = finalProviderId ?? connectedProvider;
            finalModelId =
              finalModelId ?? providersInfo.defaults[finalProviderId];
          }
        }
      }

      if (!finalProviderId || !finalModelId) {
        return {
          ok: false,
          error: 'No connected provider or model available for compaction',
        };
      }

      const result = await triggerCompaction(sessionId, settings.openCodePort, {
        providerId: finalProviderId,
        modelId: finalModelId,
      });
      return result;
    },
  );

  ipcMain.handle('fetch-session-tokens', async (_event, sessionId: string) => {
    const settings = deps.getSettings();
    return fetchSessionTokens(sessionId, settings.openCodePort);
  });

  // ─── Provider/Model IPC Handlers ───────────────────────────────────────────

  ipcMain.handle('fetch-providers', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return null;
    }
    return fetchProviders(settings.openCodePort);
  });

  ipcMain.handle('fetch-providers-info', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return null;
    }
    return fetchProvidersInfo(settings.openCodePort);
  });

  ipcMain.handle('fetch-models', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return [];
    }
    return fetchModels(settings.openCodePort);
  });

  // ─── Slash Command IPC Handlers ────────────────────────────────────────────

  ipcMain.handle('fetch-commands', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return [];
    }
    return fetchCommands(settings.openCodePort);
  });

  ipcMain.handle(
    'execute-command',
    async (
      _event,
      {
        sessionId,
        commandName,
        args,
      }: {
        sessionId: string;
        commandName: string;
        args?: Record<string, string>;
      },
    ) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return executeCommand(
        settings.openCodePort,
        sessionId,
        commandName,
        args,
      );
    },
  );

  // ─── Provider Auth IPC Handlers ────────────────────────────────────────────

  ipcMain.handle('fetch-provider-auth-methods', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return null;
    }
    return fetchProviderAuthMethods(settings.openCodePort);
  });

  ipcMain.handle(
    'authorize-provider',
    async (
      _event,
      {
        providerId,
        method,
        inputs,
      }: {
        providerId: string;
        method: number;
        inputs?: Record<string, string>;
      },
    ) => {
      ipcLog.info(
        `authorize-provider: providerId=${providerId} method=${method}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return null;
      }
      return authorizeProvider(
        settings.openCodePort,
        providerId,
        method,
        inputs,
      );
    },
  );

  ipcMain.handle(
    'callback-provider',
    async (
      _event,
      {
        providerId,
        method,
        code,
      }: {
        providerId: string;
        method: number;
        code?: string;
      },
    ) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return false;
      }
      return callbackProvider(settings.openCodePort, providerId, method, code);
    },
  );

  ipcMain.handle(
    'set-provider-api-key',
    async (
      _event,
      {
        providerId,
        apiKey,
      }: {
        providerId: string;
        apiKey: string;
      },
    ) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return false;
      }
      return setProviderApiKey(settings.openCodePort, providerId, apiKey);
    },
  );

  // ─── MCP Status IPC Handlers ─────────────────────────────────────────────────

  ipcMain.handle(
    'fetch-mcp-status',
    async (
      _event,
      { directory }: { directory?: string } = {},
    ): Promise<{
      ok: boolean;
      servers?: Array<{
        name: string;
        type: 'local' | 'remote';
        status: 'connected' | 'disconnected' | 'connecting' | 'error';
        error?: string;
        url?: string;
        command?: string[];
        environmentKeys?: string[];
        tools?: Array<{ name: string; description?: string }>;
        resources?: Array<{
          name: string;
          uri: string;
          description?: string;
          mimeType?: string;
        }>;
        prompts?: Array<{ name: string; description?: string }>;
      }>;
      error?: string;
    }> => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return fetchMcpStatus(settings.openCodePort, directory);
    },
  );

  ipcMain.handle(
    'connect-mcp',
    async (
      _event,
      { name, directory }: { name: string; directory?: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      ipcLog.info(
        `connect-mcp: name=${name} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return connectMcp(settings.openCodePort, name, directory);
    },
  );

  ipcMain.handle(
    'disconnect-mcp',
    async (
      _event,
      { name, directory }: { name: string; directory?: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      ipcLog.info(
        `disconnect-mcp: name=${name} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return disconnectMcp(settings.openCodePort, name, directory);
    },
  );

  ipcMain.handle(
    'register-mcp',
    async (
      _event,
      {
        name,
        config,
        directory,
      }: {
        name: string;
        config: {
          type: 'local' | 'remote';
          url?: string;
          command?: string[];
          environment?: Record<string, string>;
          timeout?: number;
        };
        directory?: string;
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      ipcLog.info(
        `register-mcp: name=${name} type=${config.type} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return registerMcp(settings.openCodePort, name, config, directory);
    },
  );
}
