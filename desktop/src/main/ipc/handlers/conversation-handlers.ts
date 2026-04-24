/**
 * conversation-handlers.ts — IPC handlers for conversation mirroring.
 *
 * Restores the two invoke slots the renderer preload exposes
 * (`fetch-conversation-messages`, `is-conversation-available`) that were
 * removed when the old `src/main/conversation/*` was deleted. These are
 * one-shot REST calls — no subscription state, no lifecycle. Live
 * streaming flows through `event-stream.ts` on the separate
 * `conversation-batch` channel.
 *
 *   - `fetch-conversation-messages` → `client.session.messages(sessionID)`.
 *     Response is mapped through `event-bridge` (same mapper used by the
 *     SSE pump) so the renderer sees one canonical shape regardless of
 *     origin.
 *   - `is-conversation-available` → quick health probe. Returns true when
 *     the active agent backend is `opencode` and the server is reachable.
 */

import { ipcMain } from 'electron';
import type { IpcHandlerDeps } from './types';
import { sessionMessages } from '../../utility/opencode-client';
import { mapMessage, mapPart } from '../../../shared/opencode-mapping';
import { checkOpenCodeHealth } from '../../opencode/health';
import { createLogger } from '../../utils/logger';
import type { ConversationMessage } from '../../../preload/api/types';

const log = createLogger('conversation-ipc');

export function registerConversationHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(
    'fetch-conversation-messages',
    async (
      _event,
      payload: { sessionId: string; limit?: number; before?: string },
    ): Promise<ConversationMessage[]> => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') return [];

      try {
        const hasQuery =
          payload.limit !== undefined || payload.before !== undefined;
        const response = (await sessionMessages(
          settings.openCodePort,
          payload.sessionId,
          hasQuery
            ? { limit: payload.limit, before: payload.before }
            : undefined,
        )) as { data?: Array<{ info: unknown; parts: unknown[] }> };
        const data = response.data;
        if (!Array.isArray(data)) return [];

        // Merge raw `{info, parts}` into our flat `ConversationMessage`
        // with `parts` inlined. The live streaming path keeps parts in
        // a separate `parts[messageId]` map; this REST seed delivers them
        // inlined so `seedMessages` in the renderer can split them.
        const out: ConversationMessage[] = [];
        for (const row of data) {
          const msg = mapMessage(row.info as Parameters<typeof mapMessage>[0]);
          msg.parts = (row.parts as unknown[])
            .map((p) => mapPart(p as Parameters<typeof mapPart>[0]))
            .filter(
              (p): p is NonNullable<ReturnType<typeof mapPart>> => p !== null,
            );
          out.push(msg);
        }
        return out;
      } catch (err) {
        log.warn(
          `fetch-conversation-messages failed for ${payload.sessionId}: ${String(err)}`,
        );
        return [];
      }
    },
  );

  ipcMain.handle(
    'is-conversation-available',
    async (_event, _providerId?: string): Promise<boolean> => {
      const settings = deps.getSettings();
      if (settings.agentBackend !== 'opencode') return false;
      try {
        const health = await checkOpenCodeHealth(settings.openCodePort);
        return health.available === true;
      } catch {
        return false;
      }
    },
  );
}
