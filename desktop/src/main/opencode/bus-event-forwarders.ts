import type { BrowserWindow } from 'electron';
import { clearSessionContextUsage } from './context-tracking';
import {
  autoReplyPermission,
  type BusEventHandlerDependencies,
  getQuestionOptions,
  getRegisteredConnectionForSession,
  getStringArrayProperty,
  getStringProperty,
  isFileReadPermission,
  shouldAutoApprovePermission,
} from './bus-event-utils';
import { createLogger } from '../utils/logger';

const sseLog = createLogger('sse');

export function sendToWindow(
  win: BrowserWindow,
  channel: string,
  data: unknown,
): void {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, data);
}

export function forwardPermissionEvent(
  type: string,
  properties: Record<string, unknown>,
  directory: string | undefined,
  win: BrowserWindow,
  dependencies: BusEventHandlerDependencies,
): boolean {
  if (type === 'permission.asked') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    if (!sessionID) return true;

    const registeredConnection = getRegisteredConnectionForSession(sessionID);
    const connectionId = registeredConnection?.connectionId ?? sessionID;

    const permission = getStringProperty(properties, ['permission']);
    const requestId = getStringProperty(properties, ['id']);
    const patterns = getStringArrayProperty(properties, 'patterns');
    if (!permission || !requestId) return true;

    sseLog.info(
      `permission.asked session=${sessionID} request=${requestId} permission=${permission} connection=${connectionId} patterns=${patterns?.join(',') ?? '(none)'}`,
    );

    if (isFileReadPermission(permission)) {
      const settings = dependencies.getSettings?.();
      const allowedFolders = settings?.allowedReadFolders ?? [];
      if (patterns && allowedFolders.length > 0) {
        const shouldApprove = allowedFolders.some((folder) => {
          const normalizedFolder = folder.endsWith('/') ? folder : `${folder}/`;
          return patterns.some(
            (pattern) =>
              pattern.startsWith(normalizedFolder) || pattern === folder,
          );
        });

        if (shouldApprove) {
          sseLog.info(
            `auto-approving permission request=${requestId} session=${sessionID} from allowed folders`,
          );
          void autoReplyPermission(
            sessionID,
            requestId,
            'always',
            dependencies.getOpenCodePort,
            directory,
          );
          return true;
        }
      }
    }

    const allowedPermissions =
      dependencies.getSettings?.().allowedPermissions ?? [];
    if (shouldAutoApprovePermission(permission, allowedPermissions)) {
      sseLog.info(
        `auto-approving permission request=${requestId} session=${sessionID} permission=${permission} from allowed permissions`,
      );
      void autoReplyPermission(
        sessionID,
        requestId,
        'always',
        dependencies.getOpenCodePort,
        directory,
      );
      return true;
    }

    sendToWindow(win, 'permission-asked', {
      connectionId,
      providerSessionId: sessionID,
      requestId,
      sessionID,
      permission,
      patterns,
      always: getStringArrayProperty(properties, 'always'),
      tool: properties['tool'] as
        | { messageID: string; callID: string }
        | undefined,
      metadata: properties['metadata'] as Record<string, unknown> | undefined,
      directory,
    });
    return true;
  }

  if (type === 'permission.replied') {
    sseLog.info(
      `permission.replied session=${getStringProperty(properties, ['sessionID']) ?? ''} request=${getStringProperty(properties, ['requestID']) ?? ''} reply=${String(properties['reply'] ?? '')}`,
    );
    sendToWindow(win, 'permission-replied', {
      sessionID: getStringProperty(properties, ['sessionID']) ?? '',
      requestID: getStringProperty(properties, ['requestID']) ?? '',
      reply: properties['reply'] as 'once' | 'always' | 'reject',
    });
    return true;
  }

  return false;
}

export function forwardQuestionEvent(
  type: string,
  properties: Record<string, unknown>,
  win: BrowserWindow,
): boolean {
  if (type === 'question.asked') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    const questionId = getStringProperty(properties, [
      'id',
      'questionID',
      'requestID',
    ]);
    const message = getStringProperty(properties, [
      'message',
      'question',
      'text',
      'prompt',
    ]);
    if (!sessionID || !questionId) return true;

    const registeredConnection = getRegisteredConnectionForSession(sessionID);
    const connectionId = registeredConnection?.connectionId ?? sessionID;

    const questions = Array.isArray(properties['questions'])
      ? (properties['questions'] as Array<Record<string, unknown>>).map(
          (question) => ({
            question:
              getStringProperty(question, ['question', 'message', 'text']) ??
              '',
            header: getStringProperty(question, ['header']) ?? 'Question',
            options: Array.isArray(question['options'])
              ? (question['options'] as Array<Record<string, unknown>>).map(
                  (option) => ({
                    label: getStringProperty(option, ['label', 'value']) ?? '',
                    description:
                      getStringProperty(option, ['description']) ?? '',
                  }),
                )
              : [],
            multiple: question['multiple'] === true,
            custom: question['custom'] !== false,
          }),
        )
      : message
        ? [
            {
              question: message,
              header: 'Question',
              options: (getQuestionOptions(properties) ?? []).map((label) => ({
                label,
                description: '',
              })),
              multiple: properties['multiple'] === true,
              custom: properties['custom'] !== false,
            },
          ]
        : [];

    if (questions.length === 0) return true;

    sseLog.info(
      `question.asked session=${sessionID} request=${questionId} connection=${connectionId} questions=${questions.length}`,
    );

    sendToWindow(win, 'question-asked', {
      connectionId,
      providerSessionId: sessionID,
      requestId: questionId,
      sessionID,
      questions,
      tool: properties['tool'] as
        | { messageID: string; callID: string }
        | undefined,
    });

    return true;
  }

  if (type === 'question.replied' || type === 'question.rejected') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    const questionId = getStringProperty(properties, [
      'id',
      'questionID',
      'requestID',
    ]);
    if (!sessionID || !questionId) return true;

    sseLog.info(
      `${type} session=${sessionID} request=${questionId} answer=${
        type === 'question.replied'
          ? (getStringProperty(properties, ['answer', 'reply', 'text']) ??
            '(none)')
          : '(rejected)'
      }`,
    );

    sendToWindow(win, 'question-cleared', {
      requestId: questionId,
      sessionID,
      answer:
        type === 'question.replied'
          ? getStringProperty(properties, ['answer', 'reply', 'text'])
          : undefined,
      rejected: type === 'question.rejected',
    });
    return true;
  }

  return false;
}

export function forwardConversationEvent(
  type: string,
  properties: Record<string, unknown>,
  win: BrowserWindow,
): boolean {
  if (
    type === 'message.created' ||
    type === 'message.updated' ||
    type === 'message.completed' ||
    type === 'message.removed'
  ) {
    const sessionID = getStringProperty(properties, ['sessionID']);
    if (!sessionID) return true;

    sendToWindow(win, 'conversation-message-event', {
      type,
      sessionId: sessionID,
      messageId: getStringProperty(properties, ['messageID']),
    });
    return true;
  }

  if (type === 'message.part.removed') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    const partId = getStringProperty(properties, ['partID']);
    if (!sessionID || !partId) return true;

    sendToWindow(win, 'conversation-part-event', {
      type: 'part.removed' as const,
      sessionId: sessionID,
      messageId: getStringProperty(properties, ['messageID']),
      partId,
    });
    return true;
  }

  if (type === 'message.part.delta') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    const messageID = getStringProperty(properties, ['messageID']);
    const partID = getStringProperty(properties, ['partID']);
    const field = getStringProperty(properties, ['field']);
    const delta = getStringProperty(properties, ['delta']);

    if (sessionID && messageID && partID && field && delta !== undefined) {
      sendToWindow(win, 'conversation-part-delta', {
        type: 'part.delta' as const,
        sessionId: sessionID,
        messageId: messageID,
        partId: partID,
        deltaField: field,
        deltaValue: delta,
      });
    }
    return true;
  }

  return false;
}

export function forwardSessionEvent(
  type: string,
  properties: Record<string, unknown>,
  win: BrowserWindow,
): boolean {
  if (type === 'session.status') {
    sendToWindow(win, 'session-status-update', {
      connectionId: properties['connectionId'] as string,
      status: properties['status'] as string,
      type: properties['type'] as string,
    });

    const sessionID = getStringProperty(properties, ['sessionID']);
    const status = properties['status'] as
      | { type: 'idle' | 'busy' | 'retry' }
      | undefined;
    if (sessionID && status) {
      sendToWindow(win, 'opencode-session-status', {
        sessionID,
        status: status.type ?? 'unknown',
      });
    }
    return true;
  }

  if (type === 'todo.updated') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    const todos = properties['todos'] as
      | Array<{ id: string; content: string; status: string; priority: string }>
      | undefined;
    if (sessionID && todos) {
      sendToWindow(win, 'opencode-todo-updated', { sessionID, todos });
    }
    return true;
  }

  if (type === 'vcs.branch.updated') {
    sendToWindow(win, 'opencode-vcs-updated', {
      branch: getStringProperty(properties, ['branch']) ?? null,
    });
    return true;
  }

  if (type === 'session.compacted') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    if (!sessionID) return true;

    sseLog.info(`Session compacted: sessionID=${sessionID}`);
    clearSessionContextUsage(sessionID);
    sendToWindow(win, 'session-compacted', { sessionId: sessionID });
    return true;
  }

  return false;
}
