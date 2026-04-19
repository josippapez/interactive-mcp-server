import { useEffect, useRef } from 'react';
import type { ChannelMessage, SessionNode } from '../../types';
import type { IpcListenerOpts } from './types';
import { useSessionTreeHandler as registerSessionTreeHandler } from './useSessionTreeHandler';
import { useConnectionHandlers as registerConnectionHandlers } from './useConnectionHandlers';
import { usePromptHandlers as registerPromptHandlers } from './usePromptHandlers';
import { useStatusHandlers as registerStatusHandlers } from './useStatusHandlers';
import { usePermissionHandlers as registerPermissionHandlers } from './usePermissionHandlers';
import { useQuestionHandlers as registerQuestionHandlers } from './useQuestionHandlers';
import { useSessionChannelHandlers as registerSessionChannelHandlers } from './useSessionChannelHandlers';

// Re-export types and helpers for external consumers
export type { IpcListenerOpts, SessionStatusType } from './types';
export {
  createDirectConnectionNode,
  findKeyByConnectionId,
  findPromptTargetKey,
  collectDescendantKeys,
} from './helpers';

/**
 * Registers all IPC listeners on mount.
 *
 * Session topology (tree shape, names, depths) comes from `session-tree-updated`
 * snapshots emitted by the main-process session-tree-manager.
 *
 * All prompt / channel / status events carry a `connectionId` and update the
 * matching node in place.
 */
export function useIpcListeners({
  getActiveConnectionId,
  getIsIntentionalNullSelection,
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
}: IpcListenerOpts): void {
  const listenersRegistered = useRef(false);
  // Track which connectionIds we've already loaded history for.
  const loadedHistoryIds = useRef(new Set<string>());

  useEffect(() => {
    if (listenersRegistered.current) return;
    listenersRegistered.current = true;

    // ------------------------------------------------------------------
    // Local helper: append a message to a node by its map key
    // ------------------------------------------------------------------
    const appendMessage = (
      nodeId: string,
      message: Omit<ChannelMessage, 'id'>,
    ): void => {
      withNode(nodeId, (node: SessionNode) => ({
        ...node,
        channelMessages: [
          ...node.channelMessages,
          {
            ...message,
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ],
        unreadCount:
          getActiveConnectionId() === nodeId
            ? node.unreadCount
            : node.unreadCount + 1,
      }));
    };

    // Build the shared handler context
    const context = {
      getActiveConnectionId,
      getIsIntentionalNullSelection,
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
      loadedHistoryIds,
      appendMessage,
    };

    // Register all handler groups
    registerSessionTreeHandler(context);
    registerConnectionHandlers(context);
    registerPromptHandlers(context);
    registerStatusHandlers(context);
    registerPermissionHandlers(context);
    registerQuestionHandlers(context);
    registerSessionChannelHandlers(context);

    // Request the current session tree snapshot from the main process.
    // This ensures we get the initial state even if the main process emitted
    // the snapshot before our IPC listeners were registered.
    void window.api.refreshSessionTree?.();

    // No cleanup needed — app-lifetime registrations.
    // listenersRegistered guard prevents double-registration in StrictMode.
  }, [
    getActiveConnectionId,
    getIsIntentionalNullSelection,
    activateRef,
    loadChannelHistory,
    selectChannel,
    setClientInfo,
    setNodes,
    withNode,
    clearAllNodes,
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
  ]);
}
