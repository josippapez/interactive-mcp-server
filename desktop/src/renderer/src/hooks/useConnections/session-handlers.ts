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
      console.info('[permission-toast] dispatch replyPermission', {
        sessionID,
        requestId,
        reply,
        directory,
      });
      void window.api.replyPermission(sessionID, requestId, reply, directory);
    },
    [],
  );

  const handleReplyQuestion = useCallback(
    (requestId: string, answers: string[][], sessionID: string) => {
      console.log(
        '[session-handlers] handleReplyQuestion called, requestId:',
        requestId,
        'sessionID:',
        sessionID,
        'answers:',
        answers,
      );
      void window.api
        .replyQuestion(requestId, answers, sessionID)
        .then((result) => {
          console.log('[session-handlers] replyQuestion result:', result);
          if (result?.ok) {
            setNodes((prev) => removePendingQuestion(prev, requestId));
          }
        })
        .catch((err) => {
          console.error('[session-handlers] replyQuestion error:', err);
        });
    },
    [setNodes],
  );

  const handleRejectQuestion = useCallback(
    (requestId: string, sessionID: string) => {
      console.log(
        '[session-handlers] handleRejectQuestion called, requestId:',
        requestId,
        'sessionID:',
        sessionID,
      );
      void window.api
        .rejectQuestion(requestId, sessionID)
        .then((result) => {
          console.log('[session-handlers] rejectQuestion result:', result);
          if (result?.ok) {
            setNodes((prev) => removePendingQuestion(prev, requestId));
          }
        })
        .catch((err) => {
          console.error('[session-handlers] rejectQuestion error:', err);
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
