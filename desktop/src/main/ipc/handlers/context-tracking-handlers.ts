import { ipcMain } from 'electron';
import {
  fetchSessionTokens,
  setSessionTotalTokens,
  triggerCompaction,
} from '../../opencode/context-tracking';
import { fetchProvidersInfo } from '../../opencode/provider';
import { createLogger } from '../../utils/logger';
import { IpcHandlerDeps } from './types';

const ipcLog = createLogger('ipc');

export function registerContextTrackingHandlers(deps: IpcHandlerDeps): void {
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
}
