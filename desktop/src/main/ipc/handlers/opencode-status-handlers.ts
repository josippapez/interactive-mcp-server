import { ipcMain } from 'electron';
import { checkOpenCodeHealth } from '../../opencode/health';
import { fetchVcsInfo } from '../../opencode/vcs';
import { fetchSessionStatus } from '../../opencode/session-status';
import { fetchPendingPermissions } from '../../opencode/permission-list';
import { fetchPendingQuestions } from '../../opencode/question-list';
import { searchGlobal } from '../../docs/search';
import { IpcHandlerDeps } from './types';

export function registerOpenCodeStatusHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-pending-permissions', async () => {
    const { openCodePort, agentBackend } = deps.getSettings();
    if (agentBackend !== 'opencode') {
      return [];
    }
    return fetchPendingPermissions(openCodePort);
  });

  ipcMain.handle('get-pending-questions', async () => {
    const { openCodePort, agentBackend } = deps.getSettings();
    if (agentBackend !== 'opencode') {
      return [];
    }
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
      const { openCodePort, agentBackend } = deps.getSettings();
      console.log(
        `[health-check] agentBackend=${agentBackend} openCodePort=${openCodePort}`,
      );
      if (agentBackend !== 'opencode') {
        console.log(
          `[health-check] Backend is not opencode, returning unavailable`,
        );
        return {
          available: false,
          healthy: false,
          version: null,
          error: `OpenCode backend not enabled (current: ${agentBackend})`,
        };
      }
      const result = await checkOpenCodeHealth(openCodePort);
      console.log(
        `[health-check] Result: available=${result.available} healthy=${result.healthy} error=${result.error ?? 'none'}`,
      );
      return result;
    },
  );

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
