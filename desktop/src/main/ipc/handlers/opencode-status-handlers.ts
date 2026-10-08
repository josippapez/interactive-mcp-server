import { ipcMain } from 'electron';
import { searchGlobal } from '../../docs/search-client';
import { checkOpenCodeHealth } from '../../opencode/health';
import {
  fetchOpenCodeSdkStatus,
  fetchOpenCodeUtilitySnapshot,
  fetchPendingPermissions,
  fetchPendingQuestions,
  fetchSessionStatus,
  fetchVcsDiff,
  fetchVcsInfo,
  findOpenCodeFiles,
  listOpenCodeFiles,
} from '../../utility/opencode-client';
import { withIpcResult } from './ipc-result';
import { IpcHandlerDeps } from './types';
import { getEffectiveOpenCodePort } from './shared';
import type { ReviewDiffFile } from '../../../preload/api/types';

export function registerOpenCodeStatusHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'get-pending-permissions',
    async (_event, baseDirectory?: string) => {
      const { agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return [];
      }
      const openCodePort = getEffectiveOpenCodePort(deps);
      return fetchPendingPermissions(openCodePort, baseDirectory);
    },
  );

  ipcMain.handle('get-pending-questions', async () => {
    const { agentBackend } = deps.getSettings();
    if (agentBackend !== 'opencode') {
      return [];
    }
    const openCodePort = getEffectiveOpenCodePort(deps);
    return fetchPendingQuestions(openCodePort);
  });

  ipcMain.handle(
    'check-opencode-health',
    async (): Promise<{
      available: boolean;
      healthy: boolean;
      version: string | null;
      error?: string;
    }> => {
      const { agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return {
          available: false,
          healthy: false,
          version: null,
          error: `OpenCode backend not enabled (current: ${agentBackend})`,
        };
      }
      const openCodePort = getEffectiveOpenCodePort(deps);
      return checkOpenCodeHealth(openCodePort);
    },
  );

  ipcMain.handle(
    'fetch-vcs-info',
    async (
      _event,
      baseDirectory?: string,
    ): Promise<{
      branch: string | null;
      defaultBranch: string | null;
    } | null> => {
      const { agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return null;
      }
      const openCodePort = getEffectiveOpenCodePort(deps);
      return fetchVcsInfo(openCodePort, baseDirectory);
    },
  );

  ipcMain.handle(
    'fetch-vcs-diff',
    withIpcResult(
      async (
        _event,
        options: { mode: 'git' | 'branch'; baseDirectory?: string },
      ): Promise<ReviewDiffFile[]> => {
        const { agentBackend } = deps.getSettings();
        if (agentBackend !== 'opencode') return [];
        const openCodePort = getEffectiveOpenCodePort(deps);
        return fetchVcsDiff(openCodePort, options.mode, options.baseDirectory);
      },
    ),
  );

  ipcMain.handle(
    'fetch-opencode-sdk-status',
    withIpcResult(async (_event, baseDirectory?: string) => {
      const { agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return { lsp: [], formatter: [] };
      }
      const openCodePort = getEffectiveOpenCodePort(deps);
      return fetchOpenCodeSdkStatus(openCodePort, baseDirectory);
    }),
  );

  ipcMain.handle(
    'fetch-opencode-utility-snapshot',
    withIpcResult(async (_event, baseDirectory?: string) => {
      const { agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return { path: null, project: null, toolIds: [], fileStatus: [] };
      }
      const openCodePort = getEffectiveOpenCodePort(deps);
      return fetchOpenCodeUtilitySnapshot(openCodePort, baseDirectory);
    }),
  );

  ipcMain.handle(
    'find-opencode-files',
    withIpcResult(
      async (
        _event,
        options: {
          query: string;
          baseDirectory?: string;
          limit?: number;
          type?: 'file' | 'directory';
        },
      ) => {
        const { agentBackend } = deps.getSettings();
        if (agentBackend !== 'opencode') return [];
        const openCodePort = getEffectiveOpenCodePort(deps);
        return findOpenCodeFiles(openCodePort, options);
      },
    ),
  );

  ipcMain.handle(
    'list-opencode-files',
    withIpcResult(
      async (
        _event,
        options: {
          path: string;
          baseDirectory?: string;
        },
      ) => {
        const { agentBackend } = deps.getSettings();
        if (agentBackend !== 'opencode') return [];
        const openCodePort = getEffectiveOpenCodePort(deps);
        return listOpenCodeFiles(openCodePort, options);
      },
    ),
  );

  ipcMain.handle(
    'fetch-session-status',
    async (): Promise<Record<
      string,
      { type: 'busy' | 'idle' | 'error' | 'unknown' }
    > | null> => {
      const { agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return null;
      }
      const openCodePort = getEffectiveOpenCodePort(deps);
      return fetchSessionStatus(openCodePort);
    },
  );

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
}
