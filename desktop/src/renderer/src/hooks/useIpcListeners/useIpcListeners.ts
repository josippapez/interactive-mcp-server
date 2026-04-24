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
 * Session topology (tree shape, names, depths) comes from
 * `session-tree-invalidated` events emitted by the main-process
 * session-tree-service. The renderer then pulls a fresh tree via
 * `window.api.getSessionTree()` in `useSessionTreeHandler`.
 *
 * All prompt / channel / status events carry a `connectionId` and update the
 * matching node in place.
 */
export function useIpcListeners(opts: IpcListenerOpts): void {
  const listenersRegistered = useRef(false);
  // Track which connectionIds we've already loaded history for.
  const loadedHistoryIds = useRef(new Set<string>());

  // Latest-opts ref — handlers dereference through this so the registration
  // effect can run exactly once on mount without a sprawling deps array
  // (recreated callbacks from parents would otherwise thrash the effect).
  const optsRef = useRef(opts);
  optsRef.current = opts;

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
      optsRef.current.withNode(nodeId, (node: SessionNode) => ({
        ...node,
        channelMessages: [
          ...node.channelMessages,
          {
            ...message,
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ],
        unreadCount:
          optsRef.current.getActiveConnectionId() === nodeId
            ? node.unreadCount
            : node.unreadCount + 1,
      }));
    };

    // Build the shared handler context. Every field is a stable wrapper
    // that reads the latest callback from optsRef at call time, so child
    // handlers never see a stale closure even though this context object
    // is built only once.
    const context = {
      get getActiveConnectionId() {
        return optsRef.current.getActiveConnectionId;
      },
      get getIsIntentionalNullSelection() {
        return optsRef.current.getIsIntentionalNullSelection;
      },
      get activateRef() {
        return optsRef.current.activateRef;
      },
      setNodes: ((updater) =>
        optsRef.current.setNodes(updater)) as IpcListenerOpts['setNodes'],
      selectChannel: ((...args) =>
        optsRef.current.selectChannel(
          ...args,
        )) as IpcListenerOpts['selectChannel'],
      setClientInfo: ((updater) =>
        optsRef.current.setClientInfo(
          updater,
        )) as IpcListenerOpts['setClientInfo'],
      withNode: (...args: Parameters<IpcListenerOpts['withNode']>) =>
        optsRef.current.withNode(...args),
      clearAllNodes: () => optsRef.current.clearAllNodes(),
      loadChannelHistory: (
        ...args: Parameters<IpcListenerOpts['loadChannelHistory']>
      ) => optsRef.current.loadChannelHistory(...args),
      applyStartupHistoryBuffer: (
        ...args: Parameters<IpcListenerOpts['applyStartupHistoryBuffer']>
      ) => optsRef.current.applyStartupHistoryBuffer(...args),
      applyStartupPromptBuffer: (
        ...args: Parameters<IpcListenerOpts['applyStartupPromptBuffer']>
      ) => optsRef.current.applyStartupPromptBuffer(...args),
      applyStartupPermissionBuffer: (
        ...args: Parameters<IpcListenerOpts['applyStartupPermissionBuffer']>
      ) => optsRef.current.applyStartupPermissionBuffer(...args),
      applyStartupQuestionBuffer: (
        ...args: Parameters<IpcListenerOpts['applyStartupQuestionBuffer']>
      ) => optsRef.current.applyStartupQuestionBuffer(...args),
      bufferPrompt: (...args: Parameters<IpcListenerOpts['bufferPrompt']>) =>
        optsRef.current.bufferPrompt(...args),
      bufferPermission: (
        ...args: Parameters<IpcListenerOpts['bufferPermission']>
      ) => optsRef.current.bufferPermission(...args),
      bufferQuestion: (
        ...args: Parameters<IpcListenerOpts['bufferQuestion']>
      ) => optsRef.current.bufferQuestion(...args),
      rehydrateActivePrompts: () => optsRef.current.rehydrateActivePrompts(),
      rehydratePendingPermissions: () =>
        optsRef.current.rehydratePendingPermissions(),
      rehydratePendingQuestions: () =>
        optsRef.current.rehydratePendingQuestions(),
      loadedHistoryIds,
      appendMessage,
    };

    // Register all handler groups; collect disposers so we can clean up on
    // unmount or when effect dependencies change.
    const disposers: Array<() => void> = [
      registerSessionTreeHandler(context),
      registerConnectionHandlers(context),
      registerPromptHandlers(context),
      registerStatusHandlers(context),
      registerPermissionHandlers(context),
      registerQuestionHandlers(context),
      registerSessionChannelHandlers(context),
    ];

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
      listenersRegistered.current = false;
    };
    // Intentional empty deps: listeners register once on mount. Latest
    // callbacks are always accessible via optsRef.current inside the
    // context wrappers above.
  }, []);
}
