import { ipcMain } from 'electron';
import {
  authenticateMcp,
  callbackMcpAuth,
  connectMcp,
  disconnectMcp,
  fetchMcpStatus,
  registerMcp,
  removeMcpAuth,
  startMcpAuth,
} from '../../opencode/mcp-status';
import { createLogger } from '../../utils/logger';
import { IpcHandlerDeps } from './types';

const ipcLog = createLogger('ipc');

export function registerMcpStatusHandlers(deps: IpcHandlerDeps): void {
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
        status:
          | 'connected'
          | 'disconnected'
          | 'connecting'
          | 'error'
          | 'needs_auth'
          | 'needs_client_registration';
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

  ipcMain.handle(
    'start-mcp-auth',
    async (
      _event,
      { name, directory }: { name: string; directory?: string },
    ): Promise<{ ok: boolean; authorizationUrl?: string; error?: string }> => {
      ipcLog.info(
        `start-mcp-auth: name=${name} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return startMcpAuth(settings.openCodePort, name, directory);
    },
  );

  ipcMain.handle(
    'callback-mcp-auth',
    async (
      _event,
      {
        name,
        code,
        directory,
      }: { name: string; code: string; directory?: string },
    ): Promise<{
      ok: boolean;
      status?:
        | 'connected'
        | 'disconnected'
        | 'connecting'
        | 'error'
        | 'needs_auth'
        | 'needs_client_registration';
      error?: string;
    }> => {
      ipcLog.info(
        `callback-mcp-auth: name=${name} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return callbackMcpAuth(settings.openCodePort, name, code, directory);
    },
  );

  ipcMain.handle(
    'authenticate-mcp',
    async (
      _event,
      { name, directory }: { name: string; directory?: string },
    ): Promise<{
      ok: boolean;
      status?:
        | 'connected'
        | 'disconnected'
        | 'connecting'
        | 'error'
        | 'needs_auth'
        | 'needs_client_registration';
      error?: string;
    }> => {
      ipcLog.info(
        `authenticate-mcp: name=${name} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return authenticateMcp(settings.openCodePort, name, directory);
    },
  );

  ipcMain.handle(
    'remove-mcp-auth',
    async (
      _event,
      { name, directory }: { name: string; directory?: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      ipcLog.info(
        `remove-mcp-auth: name=${name} directory=${directory ?? '(none)'}`,
      );
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') {
        return { ok: false, error: 'Not in OpenCode mode' };
      }
      return removeMcpAuth(settings.openCodePort, name, directory);
    },
  );
}
