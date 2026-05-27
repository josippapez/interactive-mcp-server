import { useCallback, useEffect } from 'react';
import type { SessionNode } from '../../types';
import type { ChannelSelectionSource } from '../../store/channel-selection';
import { getRemoveSessionTarget } from '../remove-session-target';
import { removePendingQuestion } from './remove-pending-question';

interface SessionHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
  selectChannel: (
    channelId: string | null,
    source: ChannelSelectionSource,
    intentional?: boolean,
  ) => void;
  activateRef: React.RefObject<() => void>;
}

export function resolvePermissionReplyDirectory(
  nodes: Map<string, SessionNode>,
  sessionID: string,
  directory?: string,
): string | undefined {
  if (directory) return directory;
  const node = nodes.get(sessionID);
  return node?.baseDirectory ?? node?.directory ?? undefined;
}

export function resolveNotificationSessionTarget(
  nodes: Map<string, SessionNode>,
  providerSessionId: string,
): string | null {
  return nodes.has(providerSessionId) ? providerSessionId : null;
}

export function useSessionHandlers({
  nodesRef,
  setNodes,
  selectChannel,
  activateRef,
}: SessionHandlersOptions) {
  useEffect(() => {
    return window.api.onPromptNotificationClicked?.((data) => {
      const target = resolveNotificationSessionTarget(
        nodesRef.current,
        data.providerSessionId,
      );
      if (!target) return;
      selectChannel(target, 'url-navigation');
      activateRef.current?.();
    });
  }, [activateRef, nodesRef, selectChannel]);

  const handleDismissSession = useCallback((connectionId: string) => {
    void window.api.dismissSession?.(connectionId);
  }, []);

  const handleRemoveSession = useCallback(
    (sessionId: string): Promise<boolean> => {
      const targetSessionId = getRemoveSessionTarget(
        nodesRef.current.get(sessionId),
        sessionId,
      );
      return window.api.removeSessionChannel(targetSessionId);
    },
    [nodesRef],
  );

  const handleReplyPermission = useCallback(
    (
      sessionID: string,
      requestId: string,
      reply: 'once' | 'always' | 'reject',
      directory?: string,
    ) => {
      void window.api.replyPermission(
        sessionID,
        requestId,
        reply,
        resolvePermissionReplyDirectory(nodesRef.current, sessionID, directory),
      );
    },
    [nodesRef],
  );

  const handleReplyQuestion = useCallback(
    (requestId: string, answers: string[][], sessionID: string) => {
      // Optimistically remove the question from the UI immediately. The reply
      // has been dispatched to OpenCode; leaving it displayed risks the user
      // clicking again and producing duplicate "reply for unknown request" spam.
      setNodes((prev) => removePendingQuestion(prev, requestId));
      void window.api
        .replyQuestion(requestId, answers, sessionID)
        .then((result) => {
          if (!result?.ok) {
            window.api.log?.(
              'warn',
              'session-handlers',
              `replyQuestion returned not-ok: ${result?.error ?? 'unknown'}`,
              sessionID,
            );
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          window.api.log?.(
            'error',
            'session-handlers',
            `replyQuestion error: ${message}`,
            sessionID,
          );
        });
    },
    [setNodes],
  );

  const handleRejectQuestion = useCallback(
    (requestId: string, sessionID: string) => {
      void window.api
        .rejectQuestion(requestId, sessionID)
        .then((result) => {
          if (result?.ok) {
            setNodes((prev) => removePendingQuestion(prev, requestId));
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          window.api.log?.(
            'error',
            'session-handlers',
            `rejectQuestion error: ${message}`,
            sessionID,
          );
        });
    },
    [setNodes],
  );

  return {
    handleDismissSession,
    handleRemoveSession,
    handleReplyPermission,
    handleReplyQuestion,
    handleRejectQuestion,
  };
}
