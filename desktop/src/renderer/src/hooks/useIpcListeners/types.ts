import type {
  SessionNode,
  ChannelMessage,
  PromptData,
  PendingPermission,
  PendingQuestion,
} from '../../types';
import type { ChannelSelectionSource } from '../../store/channel-selection';

export type SessionStatusType = 'info' | 'working' | 'success' | 'error';

export type IpcListenerOpts = {
  getActiveConnectionId: () => string | null;
  activateRef: React.RefObject<() => void>;
  setNodes: React.Dispatch<React.SetStateAction<Map<string, SessionNode>>>;
  /**
   * Select a channel using the global Jotai store.
   * This replaces the old setActiveId dispatch.
   */
  selectChannel: (
    channelId: string | null,
    source: ChannelSelectionSource,
    intentional?: boolean,
  ) => void;
  setClientInfo: React.Dispatch<
    React.SetStateAction<{ model?: string; mode?: string } | undefined>
  >;
  withNode: (id: string, updater: (node: SessionNode) => SessionNode) => void;
  clearAllNodes: () => void;
  loadChannelHistory: (connectionId: string) => Promise<void>;
  /** Apply any startup-buffered history for a connectionId once its node arrives. */
  applyStartupHistoryBuffer: (connectionId: string) => void;
  /** Apply any startup-buffered prompt for a session once its node arrives. */
  applyStartupPromptBuffer: (
    providerSessionId: string,
    connectionId: string | null,
  ) => void;
  applyStartupPermissionBuffer: (
    providerSessionId: string,
    connectionId: string | null,
  ) => void;
  applyStartupQuestionBuffer: (
    providerSessionId: string,
    connectionId: string | null,
  ) => void;
  /** Buffer a prompt for later application when its target node arrives. */
  bufferPrompt: (promptData: PromptData) => void;
  /** Buffer a permission request for later application when its target node arrives. */
  bufferPermission: (permission: PendingPermission) => void;
  /** Buffer a question request for later application when its target node arrives. */
  bufferQuestion: (question: PendingQuestion) => void;
  /** Re-fetch and re-apply any still-active prompts from the main process. */
  rehydrateActivePrompts: () => Promise<void>;
  rehydratePendingPermissions: () => Promise<void>;
  rehydratePendingQuestions: () => Promise<void>;
};

/**
 * Context passed to individual handler hooks.
 * Extends IpcListenerOpts with shared utilities.
 */
export type HandlerContext = IpcListenerOpts & {
  /** Ref tracking which connectionIds we've already loaded history for. */
  loadedHistoryIds: React.MutableRefObject<Set<string>>;
  /** Append a message to a node by its map key. */
  appendMessage: (nodeId: string, message: Omit<ChannelMessage, 'id'>) => void;
};
