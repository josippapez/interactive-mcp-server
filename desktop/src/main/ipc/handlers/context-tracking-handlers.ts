import { ipcMain } from 'electron';
import { fetchProvidersInfo } from '../../utility/opencode-client';
import { createLogger } from '../../utils/logger';
import { getUtilitySupervisor } from '../../utility/supervisor';
import { IpcHandlerDeps } from './types';

const ipcLog = createLogger('ipc');

/**
 * Proxy handlers for context/token tracking.
 *
 * As of Phase 2 the `context-tracking` module lives inside the backend
 * utility process. Main forwards renderer requests across the bridge so
 * there is a single authoritative copy of the per-session token
 * accumulators. Failures are surfaced to the renderer as `null` / `{ok:
 * false}` the same way the legacy in-process handlers did.
 */
export function registerContextTrackingHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle('get-context-usage', async (_event, sessionId: string) => {
    const settings = deps.getSettings();
    if (settings.agentBackend !== 'opencode') return null;
    try {
      return await getUtilitySupervisor()
        .getBridge()
        .request('get-context-usage', {
          sessionId,
          openCodePort: settings.openCodePort,
        });
    } catch (err) {
      ipcLog.warn(
        `get-context-usage RPC failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
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

      // If providerId or modelId not provided, get defaults from OpenCode API.
      let finalProviderId = providerId;
      let finalModelId = modelId;

      if (!finalProviderId || !finalModelId) {
        const providersInfo = await fetchProvidersInfo(settings.openCodePort);
        if (providersInfo) {
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

      try {
        return await getUtilitySupervisor()
          .getBridge()
          .request('trigger-compaction', {
            sessionId,
            openCodePort: settings.openCodePort,
            providerId: finalProviderId,
            modelId: finalModelId,
          });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('fetch-session-tokens', async (_event, sessionId: string) => {
    const settings = deps.getSettings();
    try {
      return await getUtilitySupervisor()
        .getBridge()
        .request('fetch-session-tokens', {
          sessionId,
          openCodePort: settings.openCodePort,
        });
    } catch (err) {
      ipcLog.warn(
        `fetch-session-tokens RPC failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  });
}
