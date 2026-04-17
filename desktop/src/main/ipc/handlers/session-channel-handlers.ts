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
} from '../../database';
import { injectOpenCodeMessage } from '../../opencode/injector';
import { injectClaudeMessageForConnection } from '../../claude-sdk-runtime';
import { searchDocs } from '../../docs/context-injector';
import { handleInjectDocContext } from '../../docs/inject-handler';
import { sendAgentMessage } from '../channel';
import { forceTerminateChat } from '../prompt';
import { closeSessionByConnectionId } from '../../mcp-server';
import { markSessionDeleted } from '../../tools/connection-guard';
import {
  triggerSessionTreeUpdate,
  tombstoneOpenCodeSession,
} from '../../session/tree-manager';
import { removePersistedSession } from '../../remove-persisted-session';
import {
  IpcHandlerDeps,
  AttachmentPayload,
  ModelSelectionPayload,
} from './types';
import { logIpcInfo, withSkillSuggestion } from './shared';

export function registerSessionChannelHandlers(deps: IpcHandlerDeps): void {
  // Save a base64 image (e.g. from clipboard) to the attachments directory
  ipcMain.handle(
    'save-clipboard-attachment',
    (_event, payload: { data: string; mimeType: string }) => {
      if (!payload || typeof payload.data !== 'string') return null;
      const filename = saveAttachmentToDisk(
        payload.data,
        payload.mimeType || 'image/png',
      );
      if (!filename) return null;
      const absolutePath = joinPath(getAttachmentsDir(), filename);
      const { port: mcpServerPort } = deps.getSettings();
      const url =
        typeof mcpServerPort === 'number' && mcpServerPort > 0
          ? attachmentUrl(filename, mcpServerPort)
          : null;
      return { filename, absolutePath, url };
    },
  );

  // Persisted session channels
  ipcMain.handle('get-persisted-session-channels', () =>
    getActiveSessionChannels(),
  );
  ipcMain.handle('get-session-channel-history', (_event, sessionId: string) =>
    getSessionChannelHistory(sessionId),
  );
  ipcMain.handle(
    'clear-session-channel-messages',
    (_event, sessionId: string) => {
      clearSessionChannelMessages(sessionId);
      deps
        .getMainWindow()
        ?.webContents.send('session-channel-messages-cleared', { sessionId });
      return true;
    },
  );
  ipcMain.handle('remove-session-channel', (_event, sessionId: string) => {
    return removePersistedSession(sessionId, {
      getWindow: deps.getMainWindow,
      getOpenCodePort: () => deps.getSettings().openCodePort,
      forceTerminateChat,
      closeSessionByConnectionId,
      deleteSessionChannel,
      deleteRegisteredConnection,
      markSessionDeleted,
      triggerSessionTreeUpdate,
      getRegisteredConnection,
      tombstoneOpenCodeSession,
    });
  });

  // Session channel — user sends a message, persist to SQLite for extension polling
  ipcMain.on(
    'queue-session-message',
    (_event, data: { sessionId: string; message: string }) => {
      logIpcInfo(
        `[queue-session-message] sessionId=${data.sessionId} messageLength=${data.message.length}`,
      );
      const outbound = withSkillSuggestion(data.message);
      queueSessionMessage(data.sessionId, outbound);
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
      },
    ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> => {
      logIpcInfo(
        `[inject-opencode-message] openCodeSessionId=${data.openCodeSessionId} noReply=${data.noReply ?? true} messageLength=${data.message.length} attachments=${data.attachments?.length ?? 0}`,
      );
      const outbound = withSkillSuggestion(data.message);
      const result = await injectOpenCodeMessage(
        data.openCodeSessionId,
        outbound,
        data.attachments,
        deps.getSettings().openCodePort,
        deps.getSettings().port,
        data.noReply ?? true,
        data.modelOverride,
      );
      logIpcInfo(
        `[inject-opencode-message] result ok=${result.ok} error=${result.error ?? 'none'} openCodeSessionId=${data.openCodeSessionId}`,
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
      const conn = getRegisteredConnection(data.connectionId);
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
          searchDocs,
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
