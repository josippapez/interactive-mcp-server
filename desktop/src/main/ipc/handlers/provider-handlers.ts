import { ipcMain } from 'electron';
import {
  authorizeProvider,
  callbackProvider,
  fetchProviderAuthMethods,
  fetchProviders,
  fetchProvidersInfo,
  setProviderApiKey,
} from '../../utility/opencode-client';
import { executeCommand, fetchCommands } from '../../utility/opencode-client';
import { createLogger } from '../../utils/logger';
import { IpcHandlerDeps } from './types';
import { getEffectiveOpenCodePort } from './shared';

const ipcLog = createLogger('ipc');

export function registerProviderHandlers(deps: IpcHandlerDeps): void {
  // ─── Provider/Model IPC Handlers ───────────────────────────────────────────

  ipcMain.handle('fetch-providers', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return null;
    }
    return fetchProviders(getEffectiveOpenCodePort(deps));
  });

  ipcMain.handle('fetch-providers-info', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return null;
    }
    return fetchProvidersInfo(getEffectiveOpenCodePort(deps));
  });

  // ─── Slash Command IPC Handlers ────────────────────────────────────────────

  ipcMain.handle('fetch-commands', async (_event, baseDirectory?: string) => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return [];
    }
    return fetchCommands(getEffectiveOpenCodePort(deps), baseDirectory);
  });

  ipcMain.handle(
    'execute-command',
    async (
      _event,
      {
        sessionId,
        commandName,
        args,
        baseDirectory,
      }: {
        sessionId: string;
        commandName: string;
        args?: Record<string, string>;
        baseDirectory?: string;
      },
    ) => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return executeCommand(
        getEffectiveOpenCodePort(deps),
        sessionId,
        commandName,
        args,
        baseDirectory,
      );
    },
  );

  // ─── Provider Auth IPC Handlers ────────────────────────────────────────────

  ipcMain.handle('fetch-provider-auth-methods', async () => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') {
      return null;
    }
    return fetchProviderAuthMethods(getEffectiveOpenCodePort(deps));
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
        getEffectiveOpenCodePort(deps),
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
      return callbackProvider(
        getEffectiveOpenCodePort(deps),
        providerId,
        method,
        code,
      );
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
      return setProviderApiKey(
        getEffectiveOpenCodePort(deps),
        providerId,
        apiKey,
      );
    },
  );
}
