import { ipcMain } from 'electron';
import {
  authorizeProvider,
  callbackProvider,
  fetchModels,
  fetchProviderAuthMethods,
  fetchProviders,
  fetchProvidersInfo,
  setProviderApiKey,
} from '../../opencode/provider';
import { executeCommand, fetchCommands } from '../../opencode/command';
import { createLogger } from '../../utils/logger';
import { IpcHandlerDeps } from './types';

const ipcLog = createLogger('ipc');

export function registerProviderHandlers(deps: IpcHandlerDeps): void {
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
}
