import { useCallback } from 'react';
import type { SessionNode } from '../../types';
import { getRemoveSessionTarget } from '../remove-session-target';
import { removePendingQuestion } from './remove-pending-question';

interface SessionHandlersOptions {
  nodesRef: React.MutableRefObject<Map<string, SessionNode>>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
}

export function useSessionHandlers({
  nodesRef,
  setNodes,
}: SessionHandlersOptions) {
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
      void window.api.replyPermission(sessionID, requestId, reply, directory);
    },
    [],
  );

  const handleReplyQuestion = useCallback(
    (requestId: string, answers: string[][], sessionID: string) => {
      void window.api
        .replyQuestion(requestId, answers, sessionID)
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
