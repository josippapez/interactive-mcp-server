import { useCallback } from 'react';
import type { SessionNode } from '../../types';
import { getRemoveSessionTarget } from '../remove-session-target';

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

  return {
    handleDismissSession,
    handleRemoveSession,
    handleReplyPermission,
  };
}
