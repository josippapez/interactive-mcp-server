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
  win: BrowserWindow,
  dependencies: BusEventHandlerDependencies,
): boolean {
  if (type === 'permission.asked') {
    const sessionID = getStringProperty(properties, ['sessionID']);
    if (!sessionID) return true;

    const registeredConnection = getRegisteredConnectionForSession(sessionID);
    const connectionId = registeredConnection?.connectionId;
    if (!connectionId) return true;

    const permission = getStringProperty(properties, ['permission']);
    const requestId = getStringProperty(properties, ['id']);
    const patterns = getStringArrayProperty(properties, 'patterns');
    if (!permission || !requestId) return true;

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
          void autoReplyPermission(
            requestId,
            'always',
            dependencies.getOpenCodePort,
          );
          return true;
        }
      }
    }

    sendToWindow(win, 'permission-asked', {
      connectionId,
      requestId,
      sessionID,
      permission,
      patterns,
      always: properties['always'] as boolean | undefined,
      tool: properties['tool'] as
        | { messageID: string; callID: string }
        | undefined,
      metadata: properties['metadata'] as Record<string, unknown> | undefined,
    });
    return true;
  }

  if (type === 'permission.replied') {
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
    if (!sessionID || !questionId || !message) return true;

    const registeredConnection = getRegisteredConnectionForSession(sessionID);
    const connectionId = registeredConnection?.connectionId;
    if (!registeredConnection || !connectionId) return true;

    sendToWindow(win, 'prompt-request', {
      id: questionId,
      message,
      projectName:
        getStringProperty(properties, ['projectName']) ??
        registeredConnection.projectName,
      predefinedOptions: getQuestionOptions(properties),
      sessionId: getStringProperty(properties, ['sessionId']),
      connectionId,
      connectionName: registeredConnection.channelName,
      timeoutSeconds: 0,
      expiresAt: 0,
      baseDirectory:
        getStringProperty(properties, ['baseDirectory', 'directory']) ??
        registeredConnection.baseDirectory ??
        undefined,
      openCodeSessionId: sessionID,
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

    const registeredConnection = getRegisteredConnectionForSession(sessionID);
    const connectionId = registeredConnection?.connectionId;
    if (!connectionId) return true;

    sendToWindow(win, 'prompt-clear', {
      id: questionId,
      connectionId,
      openCodeSessionId: sessionID,
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
