import { useMemo } from 'react';
import { useConversation } from '../../hooks/useConversation';
import { useMcpServers } from '../../hooks/useMcpServers';
import { useSessionModelId } from '../../hooks/useSessionModelId';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { useTodos } from '../../hooks/useTodos';
import { useVcsInfo } from '../../hooks/useVcsInfo';
import { useSessionModelSelection } from '../../store/session-models';

const STATUS_VISIBILITY_MS = 4000;

type SessionStatus = {
  status: string;
  type: 'info' | 'working' | 'success' | 'error';
  timestamp: Date;
};

type Args = {
  openCodeSessionId: string | null;
  isOpenCodeSession: boolean;
  sessionBaseDirectory: string | null;
  sessionStatuses: SessionStatus[];
};

export function usePromptConnectionData({
  openCodeSessionId,
  isOpenCodeSession,
  sessionBaseDirectory,
  sessionStatuses,
}: Args) {
  const {
    todos,
    isLoading: todosLoading,
    error: todosError,
    refresh: refreshTodos,
  } = useTodos(openCodeSessionId);

  const { vcsInfo } = useVcsInfo(Boolean(openCodeSessionId));

  const { messages: conversationMessages, isAvailable: conversationAvailable } =
    useConversation(
      isOpenCodeSession ? openCodeSessionId : null,
      isOpenCodeSession,
    );

  const { modelId: currentModelId, providerId: currentProviderId } =
    useSessionModelId(openCodeSessionId, isOpenCodeSession);
  const sessionModelSelection = useSessionModelSelection(openCodeSessionId);

  const { getStatus } = useSessionStatus(isOpenCodeSession);
  const sessionBusy =
    openCodeSessionId && isOpenCodeSession
      ? getStatus(openCodeSessionId) === 'busy'
      : false;

  const {
    servers: mcpServers,
    isLoading: mcpLoading,
    error: mcpError,
    refresh: refreshMcpServers,
    connect: connectMcpServer,
    disconnect: disconnectMcpServer,
    authenticate: authenticateMcpServer,
    removeAuth: removeMcpServerAuth,
  } = useMcpServers(
    isOpenCodeSession ? (sessionBaseDirectory ?? undefined) : undefined,
    isOpenCodeSession,
  );

  const latestStatus = useMemo(() => {
    const latest = sessionStatuses.at(-1) ?? null;
    if (!latest) {
      return null;
    }

    if (latest.type === 'working' || latest.type === 'error') {
      return latest;
    }

    return Date.now() - latest.timestamp.getTime() <= STATUS_VISIBILITY_MS
      ? latest
      : null;
  }, [sessionStatuses]);

  return {
    todos,
    todosLoading,
    todosError,
    refreshTodos,
    vcsInfo,
    conversationMessages,
    conversationAvailable,
    currentModelId,
    currentProviderId,
    sessionModelSelection,
    sessionBusy,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    connectMcpServer,
    disconnectMcpServer,
    authenticateMcpServer,
    removeMcpServerAuth,
    latestStatus,
  };
}
