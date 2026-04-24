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
  providerSessionId: string | null;
  isOpenCodeSession: boolean;
  sessionBaseDirectory: string | null;
  sessionStatuses: SessionStatus[];
};

export function usePromptConnectionData({
  providerSessionId,
  isOpenCodeSession,
  sessionBaseDirectory,
  sessionStatuses,
}: Args) {
  const {
    todos,
    isLoading: todosLoading,
    error: todosError,
    refresh: refreshTodos,
  } = useTodos(providerSessionId);

  const { vcsInfo } = useVcsInfo(
    Boolean(providerSessionId),
    sessionBaseDirectory,
  );

  // Live conversation wiring (C4). `useConversation` returns an empty result
  // when `providerSessionId` is null/undefined, so this is safe to call
  // unconditionally. The downstream `&&` gate at PromptView (showConversation)
  // handles provider semantics via `view.isOpenCodeSession && view.conversationAvailable`.
  const { messages, isSeeding: conversationIsSeeding } =
    useConversation(providerSessionId);
  const conversationMessages = messages;
  const conversationAvailable = isOpenCodeSession;

  const { modelId: currentModelId, providerId: currentProviderId } =
    useSessionModelId(providerSessionId, isOpenCodeSession);
  const sessionModelSelection = useSessionModelSelection(providerSessionId);

  const { getStatus } = useSessionStatus(isOpenCodeSession);
  const sessionBusy =
    providerSessionId && isOpenCodeSession
      ? getStatus(providerSessionId) === 'busy'
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
    conversationIsSeeding,
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
