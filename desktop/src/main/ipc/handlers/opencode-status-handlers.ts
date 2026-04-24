import { ipcMain } from 'electron';
import { checkOpenCodeHealth } from '../../opencode/health';
import { fetchVcsInfo } from '../../utility/opencode-client';
import { fetchSessionStatus } from '../../utility/opencode-client';
import { fetchPendingPermissions } from '../../utility/opencode-client';
import { fetchPendingQuestions } from '../../utility/opencode-client';
import { searchGlobal } from '../../docs/search-client';
import { IpcHandlerDeps } from './types';

export function registerOpenCodeStatusHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'get-pending-permissions',
    async (_event, baseDirectory?: string) => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return [];
      }
      return fetchPendingPermissions(openCodePort, baseDirectory);
    },
  );

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
    async (
      _event,
      baseDirectory?: string,
    ): Promise<{
      branch: string | null;
      defaultBranch: string | null;
    } | null> => {
      const { openCodePort, agentBackend } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return null;
      }
      return fetchVcsInfo(openCodePort, baseDirectory);
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
