import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionNode } from '../../types';
import { useIpcListeners } from '../useIpcListeners';
import { useProviderInjection } from '../useProviderInjection';
import {
  getActiveChannelIdSnapshot,
  getIntentionalNullSelectionSnapshot,
  useChannelSelection,
  type ChannelSelectionSource,
} from '../../store/channel-selection';
import { useUpdateNodesMap } from '../../store/message-dispatch';
import { setSessionGraphNodes } from '../../store/session-graph';
import { useStartupHistory } from './startup-history';
import { useStartupPrompts } from './startup-prompts';
import { useChannelHistoryLoader } from './channel-history';
import { useSideEffects } from './side-effects';
import { usePromptHandlers } from './prompt-handlers';
import { useSessionHandlers } from './session-handlers';
import { useMessageHandlers } from './message-handlers';
import { useUiHandlers } from './ui-handlers';
import { hydratePersistedSessionChannels } from './persisted-session-channels';

export function useConnections(onActivatePromptTab: () => void) {
  // ---------------------------------------------------------------------------
  // State — map key is `node.id` (providerSessionId or direct connectionId)
  // ---------------------------------------------------------------------------

  const [nodes, setNodes] = useState<Map<string, SessionNode>>(new Map());
  const [clientInfo, setClientInfo] = useState<
    { model?: string; mode?: string } | undefined
  >();

  // Use global Jotai store for channel selection
  const { activeId, isIntentionalNull, selectChannel } = useChannelSelection();

  // Sync nodes to Jotai atom for message dispatch system
  const updateNodesMap = useUpdateNodesMap();
  useEffect(() => {
    updateNodesMap(nodes);
    setSessionGraphNodes(nodes);
  }, [nodes, updateNodesMap]);

  // Stable refs
  const activateRef = useRef(onActivatePromptTab);
  activateRef.current = onActivatePromptTab;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const loadedHistoryIds = useRef(new Set<string>());

  // ---------------------------------------------------------------------------
  // Core helper — update one node by map key
  // ---------------------------------------------------------------------------

  const withNode = useCallback(
    (id: string, updater: (node: SessionNode) => SessionNode) => {
      setNodes((prev) => {
        const node = prev.get(id);
        if (!node) return prev;
        const next = new Map(prev);
        next.set(id, updater(node));
        return next;
      });
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Sub-hooks
  // ---------------------------------------------------------------------------

  const { loadChannelHistory } = useChannelHistoryLoader({
    nodesRef,
    setNodes,
  });
  const { applyStartupHistoryBuffer } = useStartupHistory({ setNodes });
  const {
    applyStartupPromptBuffer,
    applyStartupPermissionBuffer,
    applyStartupQuestionBuffer,
    bufferPrompt,
    bufferPermission,
    bufferQuestion,
    rehydrateActivePrompts,
    rehydratePendingPermissions,
    rehydratePendingQuestions,
  } = useStartupPrompts({
    setNodes,
  });

  const clearAllNodes = useCallback(() => {
    setNodes(new Map());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async (): Promise<void> => {
      const channels = await window.api.getPersistedSessionChannels?.();
      if (cancelled || !channels?.length) {
        return;
      }

      setNodes((prev) => hydratePersistedSessionChannels(prev, channels));
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useIpcListeners({
    getActiveConnectionId: getActiveChannelIdSnapshot,
    getIsIntentionalNullSelection: getIntentionalNullSelectionSnapshot,
    activateRef,
    setNodes,
    selectChannel,
    setClientInfo,
    withNode,
    clearAllNodes,
    loadChannelHistory,
    applyStartupHistoryBuffer,
    applyStartupPromptBuffer,
    applyStartupPermissionBuffer,
    applyStartupQuestionBuffer,
    bufferPrompt,
    bufferPermission,
    bufferQuestion,
    rehydrateActivePrompts,
    rehydratePendingPermissions,
    rehydratePendingQuestions,
  });

  const { inject } = useProviderInjection(nodesRef, withNode);

  // ---------------------------------------------------------------------------
  // Side-effects
  // ---------------------------------------------------------------------------

  useSideEffects({
    nodes,
    activeId,
    isIntentionalNull,
    withNode,
    selectChannel,
    loadChannelHistory,
    loadedHistoryIds,
  });

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeNode = activeId ? (nodes.get(activeId) ?? null) : null;

  // Legacy shape — PromptView and App.tsx still use `connections` / `activeConn`
  // so we expose aliased names alongside the new ones.
  const connections = nodes;
  const activeConnectionId = activeId;

  // Wrapper that tracks intentional null selections (uses Jotai store)
  const setActiveConnectionId = useCallback(
    (id: string | null, source: ChannelSelectionSource = 'hook-migration') => {
      selectChannel(id, source, id === null);
    },
    [selectChannel],
  );
  const activeConn = activeNode;

  // ---------------------------------------------------------------------------
  // Handler sub-hooks
  // ---------------------------------------------------------------------------

  const { handleSubmit, handleSelectOption } = usePromptHandlers({
    nodesRef,
    setNodes,
  });

  const {
    handleDismissSession,
    handleRemoveSession,
    handleReplyPermission,
    handleReplyQuestion,
    handleRejectQuestion,
  } = useSessionHandlers({
    nodesRef,
    setNodes,
  });

  const {
    handleQueueSessionMessage,
    handleInjectWithReply,
    handleClearChannelMessages,
  } = useMessageHandlers({
    nodesRef,
    setNodes,
    inject,
  });

  const {
    handleDismissStatus,
    handleToggleDocContext,
    jumpToFirstPendingPrompt,
  } = useUiHandlers({
    nodesRef,
    setNodes,
    withNode,
    selectChannel,
  });

  // Compatibility wrapper for setActiveId - uses Jotai store internally
  const setActiveId = useCallback(
    (id: string | null) => {
      selectChannel(id, 'hook-migration');
    },
    [selectChannel],
  );

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // New names
    nodes,
    activeId,
    setActiveId,
    activeNode,
    // Legacy aliases (used by App.tsx + PromptView — unchanged)
    connections,
    activeConnectionId,
    setActiveConnectionId,
    activeConn,
    clientInfo,
    handleSubmit,
    handleSelectOption,
    handleDismissStatus,
    handleDismissSession,
    handleQueueSessionMessage,
    handleInjectWithReply,
    handleClearChannelMessages,
    handleRemoveSession,
    handleToggleDocContext,
    handleReplyPermission,
    handleReplyQuestion,
    handleRejectQuestion,
    jumpToFirstPendingPrompt,
  };
}
