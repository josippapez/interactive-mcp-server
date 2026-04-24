import { ipcMain } from 'electron';
import { basename } from 'path';
import {
  getRegisteredConnectionBySessionId,
  upsertRegisteredConnection,
} from '../../utility/db-client';
import { createOpenCodeSession } from '../../utility/opencode-client';
import { injectOpenCodeMessage } from '../../utility/opencode-client';
import {
  replyToOpenCodeQuestion,
  rejectOpenCodeQuestion,
} from '../../utility/opencode-client';
import { fetchTodosForSession } from '../../utility/opencode-client';
import { abortOpenCodeSession } from '../../utility/opencode-client';
import {
  fetchSessionTree,
  getSelectedFolder,
  invalidateSessionTree,
  setSelectedFolder,
} from '../../utility/session-client';
import { reconcileSessionConnections } from '../../utility/session-client';
import { getUtilitySupervisor } from '../../utility/supervisor';
import {
  IpcHandlerDeps,
  AttachmentPayload,
  ModelSelectionPayload,
} from './types';
import { logIpcInfo } from './shared';

export function registerSessionTreeHandlers(deps: IpcHandlerDeps): void {
  // Pull-on-invalidation: return the current session tree snapshot on demand.
  ipcMain.handle('get-session-tree', async () => {
    return fetchSessionTree();
  });

  // Renderer-triggered invalidation (user-clicked "refresh" button in sidebar).
  // Fires `session-tree-invalidated` so the renderer refetches. A plain
  // refetch would also work, but routing through invalidate() lets multiple
  // renderer surfaces (sidebar + main) stay consistent on the same schedule.
  ipcMain.handle('invalidate-session-tree', async () => {
    invalidateSessionTree();
  });

  // Set the currently selected project folder for sidebar session scoping.
  // When `baseDirectory` is null, the sidebar renders its empty state until
  // the user picks a folder.
  ipcMain.handle(
    'set-selected-folder',
    async (_event, baseDirectory: string | null): Promise<void> => {
      const trimmed = baseDirectory?.trim() ?? '';
      const nextFolder = trimmed.length > 0 ? trimmed : null;

      if ((await getSelectedFolder()) === nextFolder) {
        // No change — nothing to do.
        return;
      }

      logIpcInfo(
        `set-selected-folder: ${nextFolder ?? '(none)'} (was ${(await getSelectedFolder()) ?? '(none)'})`,
      );

      // setSelectedFolder also invalidates the session tree so the renderer
      // refetches against the new folder scope.
      await setSelectedFolder(nextFolder);

      if (nextFolder) {
        const { openCodePort } = deps.getSettings();
        // Reconcile stale DB entries for this folder before the renderer
        // pulls the fresh tree.
        await reconcileSessionConnections(openCodePort, nextFolder);
        invalidateSessionTree();
      }
    },
  );

  // Permission reply — forward agent decision to OpenCode
  ipcMain.handle(
    'reply-permission',
    async (
      _event,
      data: {
        sessionID: string;
        requestID: string;
        reply: 'once' | 'always' | 'reject';
        directory?: string;
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      const { openCodePort } = deps.getSettings();
      logIpcInfo(
        `reply-permission session=${data.sessionID} request=${data.requestID} reply=${data.reply}`,
      );
      try {
        return await getUtilitySupervisor()
          .getBridge()
          .request<{ ok: boolean; error?: string }>('reply-permission', {
            openCodePort,
            sessionID: data.sessionID,
            requestID: data.requestID,
            reply: data.reply,
            directory: data.directory,
          });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'reply-question',
    async (
      _event,
      data: { requestID: string; answers: string[][]; sessionID: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      const { openCodePort } = deps.getSettings();
      logIpcInfo(
        `reply-question: requestID=${data.requestID} sessionID=${data.sessionID} answers=${JSON.stringify(data.answers)}`,
      );
      const result = await replyToOpenCodeQuestion(
        openCodePort,
        data.requestID,
        data.answers,
        data.sessionID,
      );
      logIpcInfo(`reply-question result: ${JSON.stringify(result)}`);
      return result;
    },
  );

  ipcMain.handle(
    'reject-question',
    async (
      _event,
      data: { requestID: string; sessionID: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      const { openCodePort } = deps.getSettings();
      logIpcInfo(
        `reject-question: requestID=${data.requestID} sessionID=${data.sessionID}`,
      );
      const result = await rejectOpenCodeQuestion(
        openCodePort,
        data.requestID,
        data.sessionID,
      );
      logIpcInfo(`reject-question result: ${JSON.stringify(result)}`);
      return result;
    },
  );

  ipcMain.handle(
    'fetch-session-todos',
    async (
      _event,
      sessionId: string,
    ): Promise<{
      todos: { content: string; status: string; priority: string }[] | null;
      error?: string;
    }> => {
      const { openCodePort } = deps.getSettings();
      const todos = await fetchTodosForSession(openCodePort, sessionId);
      if (todos === null) {
        return { todos: null, error: 'Failed to fetch todos' };
      }
      return { todos };
    },
  );

  ipcMain.handle(
    'abort-session',
    async (
      _event,
      sessionId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      const { openCodePort } = deps.getSettings();
      const success = await abortOpenCodeSession(openCodePort, sessionId);
      if (!success) {
        return { success: false, error: 'Failed to abort session' };
      }
      return { success: true };
    },
  );

  ipcMain.handle(
    'create-opencode-session',
    async (
      _event,
      data: {
        title?: string;
        parentID?: string;
        initialMessage?: string;
        baseDirectory?: string;
        attachments?: AttachmentPayload[];
        modelSelection?: ModelSelectionPayload;
        agent?: string;
      },
    ): Promise<{
      ok: boolean;
      sessionId?: string;
      error?: string;
    }> => {
      logIpcInfo(
        `create-opencode-session: title=${data.title ?? '(none)'} parentID=${data.parentID ?? '(none)'} baseDirectory=${data.baseDirectory ?? '(none)'} agent=${data.agent ?? '(none)'}`,
      );
      const {
        openCodePort,
        agentBackend,
        port: mcpServerPort,
      } = deps.getSettings();
      if (agentBackend !== 'opencode') {
        return {
          ok: false,
          error: `OpenCode backend not enabled (current: ${agentBackend})`,
        };
      }

      const hasAttachments = (data.attachments?.length ?? 0) > 0;
      const hasInitialMessage = (data.initialMessage?.trim().length ?? 0) > 0;
      const hasModelSelection = Boolean(data.modelSelection);

      // Inject path is required when we need capabilities only supported by
      // injectOpenCodeMessage (attachments and/or explicit model selection).
      // Note: attachments-only submissions are valid from the blank new-session page.
      const needsInject =
        (hasAttachments || hasModelSelection) &&
        (hasAttachments || hasInitialMessage);

      logIpcInfo(
        `create-opencode-session flags: hasInitialMessage=${hasInitialMessage} hasAttachments=${hasAttachments} hasModelSelection=${hasModelSelection} needsInject=${needsInject}`,
      );
      if (hasModelSelection) {
        logIpcInfo(
          `create-opencode-session modelSelection: providerId=${data.modelSelection?.providerId ?? '(none)'} modelId=${data.modelSelection?.modelId ?? '(none)'} variant=${data.modelSelection?.variant ?? '(none)'}`,
        );
      }

      const result = await createOpenCodeSession(openCodePort, {
        title: data.title,
        parentID: data.parentID,
        initialMessage:
          !needsInject && hasInitialMessage ? data.initialMessage : undefined,
        directory: data.baseDirectory,
        agent: data.agent,
      });

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      if (needsInject && result.session?.id) {
        const modelOverride = data.modelSelection
          ? {
              providerId: data.modelSelection.providerId,
              modelId: data.modelSelection.modelId,
              variant: data.modelSelection.variant,
            }
          : undefined;

        const injectResult = await injectOpenCodeMessage(
          result.session.id,
          data.initialMessage ?? '',
          data.attachments,
          openCodePort,
          mcpServerPort,
          false,
          modelOverride,
          undefined,
          data.agent,
        );

        if (!injectResult.ok) {
          console.warn(
            `[create-opencode-session] Session created but initial message injection failed: ${injectResult.error}`,
          );
        }
      }

      // If a baseDirectory was provided, upsert the registered connection immediately.
      if (data.baseDirectory && result.session?.id) {
        const existing = await getRegisteredConnectionBySessionId(
          result.session.id,
          'opencode',
        );
        await upsertRegisteredConnection({
          providerType: 'opencode',
          providerSessionId: result.session.id,
          connectionId: existing?.connectionId ?? null,
          channelName: existing?.channelName ?? data.title ?? 'New Session',
          projectName: existing?.projectName ?? basename(data.baseDirectory),
          baseDirectory: data.baseDirectory,
          parentSessionId: existing?.parentSessionId ?? data.parentID ?? null,
        });
        const corrected = await getRegisteredConnectionBySessionId(
          result.session.id,
          'opencode',
        );
        logIpcInfo(
          `[create-opencode-session] pre-refresh claim sessionId=${result.session.id} selectedBaseDirectory=${data.baseDirectory} finalBaseDirectory=${corrected?.baseDirectory ?? '(none)'} finalConnectionId=${corrected?.connectionId ?? '(none)'}`,
        );
      }

      invalidateSessionTree();

      if (result.session?.id) {
        const refreshed = await getRegisteredConnectionBySessionId(
          result.session.id,
          'opencode',
        );
        logIpcInfo(
          `[create-opencode-session] post-refresh sessionId=${result.session.id} selectedBaseDirectory=${data.baseDirectory ?? '(none)'} refreshedBaseDirectory=${refreshed?.baseDirectory ?? '(none)'} refreshedConnectionId=${refreshed?.connectionId ?? '(none)'}`,
        );
      }

      if (data.baseDirectory && result.session?.id) {
        invalidateSessionTree();
      }

      return { ok: true, sessionId: result.session?.id };
    },
  );
}
