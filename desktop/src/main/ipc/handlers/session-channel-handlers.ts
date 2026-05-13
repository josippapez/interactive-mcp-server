import { ipcMain } from 'electron';
import { join as joinPath } from 'path';
import {
  saveAttachment as saveAttachmentToDisk,
  getAttachmentsDir,
  attachmentUrl,
} from '../../attachment-store';
import {
  queueSessionMessage,
  getActiveSessionChannels,
  getSessionChannelHistory,
  clearSessionChannelMessages,
  deleteSessionChannel,
  deleteRegisteredConnection,
  getRegisteredConnection,
  upsertContextInjection,
} from '../../utility/db-client';
import { injectOpenCodeMessage } from '../../utility/opencode-client';
import { sessionDelete } from '../../utility/backend/session-api';
import { injectClaudeMessageForConnection } from '../../claude-sdk-runtime';
import { searchDocsInWorker } from '../../docs/context-injector-worker';
import { handleInjectDocContext } from '../../docs/inject-handler';
import { sendAgentMessage } from '../channel';
import { forceTerminateChat } from '../prompt';
import {
  closeSessionByConnectionId,
  markSessionDeleted,
} from '../../utility/mcp-server-client';
import { tombstoneOpenCodeSession } from '../../utility/session-client';
import { invalidateSessionTree } from '../../utility/session-client';
import { removePersistedSession } from '../../remove-persisted-session';
import {
  IpcHandlerDeps,
  AttachmentPayload,
  ModelSelectionPayload,
} from './types';
import { logIpcInfo, withSkillSuggestion } from './shared';
import { writeSessionLog } from '../../utils/session-logger';

function formatModelSelectionForLog(
  modelSelection: ModelSelectionPayload | undefined,
): string {
  if (!modelSelection) return '(none)';
  return `${modelSelection.providerId}/${modelSelection.modelId}/${modelSelection.variant ?? 'default'}`;
}

export function registerSessionChannelHandlers(deps: IpcHandlerDeps): void {
  // Save a base64 image (e.g. from clipboard) to the per-session attachments
  // directory under os.tmpdir().
  ipcMain.handle(
    'save-clipboard-attachment',
    (
      _event,
      payload: { sessionKey: string; data: string; mimeType: string },
    ) => {
      if (
        !payload ||
        typeof payload.data !== 'string' ||
        typeof payload.sessionKey !== 'string' ||
        !payload.sessionKey
      ) {
        return null;
      }
      const filename = saveAttachmentToDisk(
        payload.sessionKey,
        payload.data,
        payload.mimeType || 'image/png',
      );
      if (!filename) return null;
      const dir = getAttachmentsDir(payload.sessionKey);
      const absolutePath = dir ? joinPath(dir, filename) : null;
      const { port: mcpServerPort } = deps.getSettings();
      const url =
        typeof mcpServerPort === 'number' && mcpServerPort > 0
          ? attachmentUrl(payload.sessionKey, filename, mcpServerPort)
          : null;
      return { filename, absolutePath, url };
    },
  );

  // Persisted session channels
  ipcMain.handle('get-persisted-session-channels', async () =>
    getActiveSessionChannels(),
  );
  ipcMain.handle(
    'get-session-channel-history',
    async (_event, sessionId: string) => getSessionChannelHistory(sessionId),
  );
  ipcMain.handle(
    'clear-session-channel-messages',
    async (_event, sessionId: string) => {
      await clearSessionChannelMessages(sessionId);
      deps
        .getMainWindow()
        ?.webContents.send('session-channel-messages-cleared', { sessionId });
      return true;
    },
  );
  ipcMain.handle(
    'remove-session-channel',
    async (_event, sessionId: string) => {
      return removePersistedSession(sessionId, {
        getOpenCodePort: () => {
          const p = deps.getSettings().openCodePort;
          return typeof p === 'number' && p > 0 ? p : null;
        },
        deleteOpenCodeSession: async (
          providerSessionId: string,
          port: number,
          directory?: string,
        ) => {
          // Calls OpenCode's DELETE /session/{id}. The OpenCode server
          // cascades to children automatically. Treat HTTP 404 as success
          // (already deleted) so retried/idempotent deletes don't spam logs.
          try {
            const result = await sessionDelete(port, providerSessionId, {
              directory,
            });
            const status = result?.response?.status;
            if (typeof status === 'number' && status === 404) {
              // Idempotent — already gone upstream.
              return;
            }
            if (result?.error) {
              const errStatus = (
                result.error as { status?: number; statusCode?: number }
              )?.status;
              if (errStatus === 404) return;
              throw result.error;
            }
          } catch (err) {
            // Re-throw 404 errors as success; otherwise propagate so the
            // orchestrator's catch-and-log path takes over.
            const status =
              (
                err as {
                  status?: number;
                  statusCode?: number;
                  response?: { status?: number };
                }
              )?.status ??
              (err as { response?: { status?: number } })?.response?.status;
            if (status === 404) return;
            throw err;
          }
        },
        forceTerminateChat,
        closeSessionByConnectionId,
        deleteSessionChannel,
        deleteRegisteredConnection,
        markSessionDeleted,
        invalidate: invalidateSessionTree,
        getRegisteredConnection,
        tombstoneOpenCodeSession,
      });
    },
  );

  // Session channel — user sends a message, persist to SQLite for extension polling
  ipcMain.on(
    'queue-session-message',
    async (_event, data: { sessionId: string; message: string }) => {
      logIpcInfo(
        `[queue-session-message] sessionId=${data.sessionId} messageLength=${data.message.length}`,
      );
      writeSessionLog(
        deps.getLogsDir(),
        data.sessionId,
        'INFO',
        'ipc:queue-session-message',
        `messageLength=${data.message.length}`,
      );
      const outbound = await withSkillSuggestion(data.message);
      await queueSessionMessage(data.sessionId, outbound);
      logIpcInfo(
        `[queue-session-message] queued to sessionId=${data.sessionId}`,
      );
    },
  );

  // Inject a message into an OpenCode session via its HTTP API.
  ipcMain.handle(
    'inject-opencode-message',
    async (
      _event,
      data: {
        openCodeSessionId: string;
        message: string;
        attachments?: AttachmentPayload[];
        noReply?: boolean;
        modelOverride?: ModelSelectionPayload;
        /**
         * Optional per-message OpenCode agent override (e.g. 'plan',
         * 'docs-maintainer'). Whitespace-only or empty strings are treated
         * as "no override". NOTE: when set, OpenCode persists this agent
         * on the session via `AgentSwitched`, so subsequent assistant
         * messages use it until another switch occurs — not single-prompt.
         */
        agent?: string;
      },
    ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> => {
      logIpcInfo(
        `[inject-opencode-message] openCodeSessionId=${data.openCodeSessionId} noReply=${data.noReply ?? true} messageLength=${data.message.length} attachments=${data.attachments?.length ?? 0} agent=${data.agent ?? '(none)'} model=${formatModelSelectionForLog(data.modelOverride)}`,
      );
      writeSessionLog(
        deps.getLogsDir(),
        data.openCodeSessionId,
        'INFO',
        'ipc:inject-opencode-message',
        `noReply=${data.noReply ?? true} messageLength=${data.message.length} attachments=${data.attachments?.length ?? 0} agent=${data.agent ?? '(none)'} model=${formatModelSelectionForLog(data.modelOverride)}`,
      );
      const outbound = await withSkillSuggestion(data.message);
      const result = await injectOpenCodeMessage(
        data.openCodeSessionId,
        outbound,
        data.attachments,
        deps.getSettings().openCodePort,
        deps.getSettings().port,
        data.noReply ?? true,
        data.modelOverride,
        undefined,
        data.agent,
      );
      logIpcInfo(
        `[inject-opencode-message] result ok=${result.ok} error=${result.error ?? 'none'} openCodeSessionId=${data.openCodeSessionId}`,
      );
      writeSessionLog(
        deps.getLogsDir(),
        data.openCodeSessionId,
        result.ok ? 'INFO' : 'ERROR',
        'ipc:inject-opencode-message',
        `result ok=${result.ok} error=${result.error ?? 'none'}`,
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
        attachments?: AttachmentPayload[];
      },
    ): Promise<{
      ok: boolean;
      sessionId?: string;
      responseText?: string;
      error?: string;
    }> => {
      const conn = await getRegisteredConnection(data.connectionId);
      const providerSessionId = conn?.providerSessionId;
      if (!providerSessionId) {
        return {
          ok: false,
          error: `No provider session found for connectionId=${data.connectionId}`,
        };
      }
      return injectClaudeMessageForConnection({
        providerSessionId,
        message: data.message,
        baseDirectory: data.baseDirectory,
        attachments: data.attachments,
      });
    },
  );

  /**
   * Inject relevant repository documentation context into an OpenCode session
   * immediately before the user's outbound message.
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
          searchDocs: searchDocsInWorker,
          injectOpenCodeMessage,
          upsertContextInjection,
          sendAgentMessage: (providerSessionId, message) => {
            sendAgentMessage(deps.getMainWindow(), providerSessionId, message);
          },
        },
      );
    },
  );
}
