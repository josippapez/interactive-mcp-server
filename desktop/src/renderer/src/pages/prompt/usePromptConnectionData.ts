import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useConversation } from '../../hooks/useConversation';
import { useMcpServers } from '../../hooks/useMcpServers';
import { useSessionModelId } from '../../hooks/useSessionModelId';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { useTodos } from '../../hooks/useTodos';
import { useVcsInfo } from '../../hooks/useVcsInfo';
import type { NativeOpenCodeSkill } from '../../../../preload/api/types';
import { useSessionModelSelection } from '../../store/session-models';
import { findModelById, modelsAtom } from '../../store/providers';

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

  const {
    modelId: currentModelId,
    providerId: currentProviderId,
    variant: currentVariant,
  } = useSessionModelId(providerSessionId, isOpenCodeSession);
  const sessionModelSelection = useSessionModelSelection(providerSessionId);

  // Context window of the model that produced the most recent assistant
  // message. Independent of the composer dropdown override so the context
  // bar reflects what is actually running, not what is queued for the next
  // send. Falls back to undefined when no message has been sent yet, in
  // which case `ContextUsageBar` uses its cached `usage.contextLimit`.
  const models = useAtomValue(modelsAtom);
  const runningContextWindow = useMemo(() => {
    if (!currentModelId) return undefined;
    return findModelById(models, currentModelId, currentProviderId)
      ?.contextWindow;
  }, [models, currentModelId, currentProviderId]);

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

  const [nativeSkills, setNativeSkills] = useState<NativeOpenCodeSkill[]>([]);
  const activeSkills = nativeSkills;

  useEffect(() => {
    if (!isOpenCodeSession) {
      setNativeSkills([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      let all: NativeOpenCodeSkill[];
      try {
        all = await window.api.listNativeOpenCodeSkills(
          sessionBaseDirectory ?? undefined,
        );
      } catch {
        all = [];
      }
      if (cancelled) return;
      setNativeSkills(all);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpenCodeSession, sessionBaseDirectory]);

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
    currentVariant,
    sessionModelSelection,
    runningContextWindow,
    sessionBusy,
    mcpServers,
    mcpLoading,
    mcpError,
    refreshMcpServers,
    connectMcpServer,
    disconnectMcpServer,
    authenticateMcpServer,
    removeMcpServerAuth,
    activeSkills,
    latestStatus,
  };
}
