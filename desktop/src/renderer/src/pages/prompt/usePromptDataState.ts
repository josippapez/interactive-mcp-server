import { useMemo } from 'react';
import { useConversation } from '../../hooks/useConversation';
import { useMcpServers } from '../../hooks/useMcpServers';
import { useSessionModelId } from '../../hooks/useSessionModelId';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { useTodos } from '../../hooks/useTodos';
import { useVcsInfo } from '../../hooks/useVcsInfo';

type Args = {
  openCodeSessionId: string | null;
  isOpenCodeSession: boolean;
  sessionBaseDirectory: string | null;
  sessionStatuses: { status: string; type: string; timestamp: Date }[];
};

export function usePromptDataState({
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
  } = useMcpServers(
    isOpenCodeSession ? sessionBaseDirectory ?? undefined : undefined,
    isOpenCodeSession,
  );

  const latestStatus = useMemo(
    () => sessionStatuses.at(-1) ?? null,
    [sessionStatuses],
  );

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
    sessionBusy,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    latestStatus,
  };
}
