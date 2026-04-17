import { ipcRenderer } from 'electron';
import type {
  ConversationMessagePart,
  PendingQuestionRequest,
  PromptClearData,
  PromptRequest,
  SessionTreeNode,
} from './types';

export function createEventsApi() {
  return {
    // Prompt events
    onPromptRequest: (callback: (data: PromptRequest) => void) => {
      ipcRenderer.removeAllListeners('prompt-request');
      ipcRenderer.on('prompt-request', (_event, data) => callback(data));
    },
    onPromptClear: (callback: (data: PromptClearData) => void) => {
      ipcRenderer.removeAllListeners('prompt-clear');
      ipcRenderer.on('prompt-clear', (_event, data) => callback(data));
    },

    // Intensive chat lifecycle
    onIntensiveChatStart: (
      callback: (data: {
        sessionId: string;
        title: string;
        connectionId: string;
        providerSessionId?: string | null;
      }) => void,
    ) => {
      ipcRenderer.removeAllListeners('intensive-chat-start');
      ipcRenderer.on('intensive-chat-start', (_event, data) => callback(data));
    },
    onIntensiveChatStop: (
      callback: (data: {
        sessionId: string;
        connectionId: string;
        providerSessionId?: string | null;
      }) => void,
    ) => {
      ipcRenderer.removeAllListeners('intensive-chat-stop');
      ipcRenderer.on('intensive-chat-stop', (_event, data) => callback(data));
    },

    // Session tree — full snapshot of all OpenCode sessions + direct connections.
    // Emitted every ~2 s by session-tree-manager and immediately after
    // register_connection or session removal.
    onSessionTreeUpdated: (callback: (nodes: SessionTreeNode[]) => void) => {
      ipcRenderer.removeAllListeners('session-tree-updated');
      ipcRenderer.on('session-tree-updated', (_event, data) => callback(data));
    },
    onOptimisticSessionNodeCreated: (
      callback: (node: SessionTreeNode) => void,
    ) => {
      ipcRenderer.removeAllListeners('session-node-created-optimistic');
      ipcRenderer.on('session-node-created-optimistic', (_event, data) =>
        callback(data),
      );
    },

    // Direct-connection lifecycle — fired when an MCP agent connects/disconnects
    // but has no associated OpenCode session (i.e. it never called register_connection
    // with an openCodeSessionId and OpenCode is not running).
    onConnectionOpened: (
      callback: (data: {
        connectionId: string;
        name: string;
        sessionId?: string;
        label?: string;
        providerType?: 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone';
      }) => void,
    ) => {
      ipcRenderer.removeAllListeners('connection-opened');
      ipcRenderer.on('connection-opened', (_event, data) => callback(data));
    },
    onConnectionClosed: (
      callback: (data: { connectionId: string }) => void,
    ) => {
      ipcRenderer.removeAllListeners('connection-closed');
      ipcRenderer.on('connection-closed', (_event, data) => callback(data));
    },
    onChannelLabelUpdated: (
      callback: (data: {
        connectionId: string;
        name: string;
        providerSessionId?: string | null;
      }) => void,
    ) => {
      ipcRenderer.removeAllListeners('channel-label-updated');
      ipcRenderer.on('channel-label-updated', (_event, data) => callback(data));
    },

    // Settings changes
    onSettingsChanged: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('settings-changed', handler);
      return () => {
        ipcRenderer.removeListener('settings-changed', handler);
      };
    },

    // Fired when the agent sends a message via send_message tool
    onAgentMessage: (
      callback: (data: {
        connectionId: string;
        message: string;
        providerSessionId?: string | null;
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('agent-message');
      ipcRenderer.on('agent-message', (_event, data) => callback(data));
    },

    // Fired when POST /api/sessions creates a new channel
    onSessionChannelCreated: (
      callback: (data: { sessionId: string; label?: string }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('session-channel-created');
      ipcRenderer.on('session-channel-created', (_event, data) =>
        callback(data),
      );
    },

    // Fired when DELETE /api/sessions/:sessionId cleans up a channel
    onSessionChannelDeleted: (
      callback: (data: { sessionId: string }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('session-channel-deleted');
      ipcRenderer.on('session-channel-deleted', (_event, data) =>
        callback(data),
      );
    },
    onSessionChannelMessagesCleared: (
      callback: (data: { sessionId: string }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('session-channel-messages-cleared');
      ipcRenderer.on('session-channel-messages-cleared', (_event, data) =>
        callback(data),
      );
    },

    onDatabaseReset: (
      callback: (data: {
        ok: boolean;
        clearedTables: string[];
        removedIdFiles: number;
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('database-reset');
      ipcRenderer.on('database-reset', (_event, data) => callback(data));
    },

    // Agent-pushed status updates
    onSessionStatusUpdate: (
      callback: (data: {
        connectionId: string;
        status: string;
        type: string;
        providerSessionId?: string | null;
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('session-status-update');
      ipcRenderer.on('session-status-update', (_event, data) => callback(data));
    },

    // Permission events from OpenCode bus
    onPermissionAsked: (
      callback: (data: {
        connectionId: string;
        requestId: string;
        sessionID: string;
        directory?: string;
        permission: string;
        patterns?: string[];
        always?: string[];
        tool?: { messageID: string; callID: string };
        metadata?: Record<string, unknown>;
        providerSessionId?: string | null;
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('permission-asked');
      ipcRenderer.on('permission-asked', (_event, data) => callback(data));
    },

    onPermissionReplied: (
      callback: (data: {
        sessionID: string;
        requestID: string;
        reply: 'once' | 'always' | 'reject';
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('permission-replied');
      ipcRenderer.on('permission-replied', (_event, data) => callback(data));
    },

    onQuestionAsked: (
      callback: (
        data: PendingQuestionRequest & {
          connectionId: string;
          providerSessionId?: string | null;
        },
      ) => void,
    ): void => {
      ipcRenderer.removeAllListeners('question-asked');
      ipcRenderer.on('question-asked', (_event, data) => callback(data));
    },

    onQuestionCleared: (
      callback: (data: {
        requestId: string;
        sessionID: string;
        answer?: string;
        rejected?: boolean;
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('question-cleared');
      ipcRenderer.on('question-cleared', (_event, data) => callback(data));
    },

    onSkillsUpdated: (callback: () => void): void => {
      ipcRenderer.removeAllListeners('skills-updated');
      ipcRenderer.on('skills-updated', () => callback());
    },

    // Listen for todo updates (emitted by the main process when todos change)
    onTodosUpdated: (
      callback: (data: {
        sessionId: string;
        todos: {
          content: string;
          status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
          priority: 'high' | 'medium' | 'low';
        }[];
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('todos-updated');
      ipcRenderer.on('todos-updated', (_event, data) => callback(data));
    },

    // ─── SSE Event Listeners (real-time updates from OpenCode) ─────────────────

    /**
     * Real-time todo updates via SSE (todo.updated event)
     * Replaces polling when available
     */
    onOpenCodeTodoUpdated: (
      callback: (data: {
        sessionID: string;
        todos: {
          id: string;
          content: string;
          status: string;
          priority: string;
        }[];
      }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('opencode-todo-updated');
      ipcRenderer.on('opencode-todo-updated', (_event, data) => callback(data));
    },

    /**
     * Real-time VCS branch updates via SSE (vcs.branch.updated event)
     * Replaces polling when available
     */
    onOpenCodeVcsUpdated: (
      callback: (data: { branch: string | null }) => void,
    ): void => {
      ipcRenderer.removeAllListeners('opencode-vcs-updated');
      ipcRenderer.on('opencode-vcs-updated', (_event, data) => callback(data));
    },

    /**
     * Real-time session status updates via SSE (session.status event)
     * Replaces polling when available
     *
     * NOTE: Returns a cleanup function to support multiple subscribers.
     * Each caller should invoke the returned function in their effect cleanup.
     */
    onOpenCodeSessionStatus: (
      callback: (data: { sessionID: string; status: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionID: string; status: string },
      ) => callback(data);
      ipcRenderer.on('opencode-session-status', handler);
      return () => {
        ipcRenderer.removeListener('opencode-session-status', handler);
      };
    },

    /**
     * Listen for conversation message events (created, updated, completed).
     *
     * NOTE: Returns a cleanup function to support multiple subscribers.
     * Each caller should invoke the returned function in their effect cleanup.
     */
    onConversationMessageEvent: (
      callback: (data: {
        type:
          | 'message.created'
          | 'message.updated'
          | 'message.completed'
          | 'message.removed';
        sessionId: string;
        messageId?: string;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          type:
            | 'message.created'
            | 'message.updated'
            | 'message.completed'
            | 'message.removed';
          sessionId: string;
          messageId?: string;
        },
      ) => callback(data);
      ipcRenderer.on('conversation-message-event', handler);
      return () => {
        ipcRenderer.removeListener('conversation-message-event', handler);
      };
    },

    /**
     * Listen for conversation part events (added, updated).
     */
    onConversationPartEvent: (
      callback: (data: {
        type: 'part.added' | 'part.updated' | 'part.removed';
        sessionId: string;
        messageId?: string;
        part?: ConversationMessagePart;
        partId?: string;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          type: 'part.added' | 'part.updated' | 'part.removed';
          sessionId: string;
          messageId?: string;
          part?: ConversationMessagePart;
          partId?: string;
        },
      ) => callback(data);
      ipcRenderer.on('conversation-part-event', handler);
      return () => {
        ipcRenderer.removeListener('conversation-part-event', handler);
      };
    },

    /**
     * Listen for conversation part delta events (streaming text updates).
     */
    onConversationPartDelta: (
      callback: (data: {
        type: 'part.delta';
        sessionId: string;
        messageId: string;
        partId: string;
        deltaField: string;
        deltaValue: string;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          type: 'part.delta';
          sessionId: string;
          messageId: string;
          partId: string;
          deltaField: string;
          deltaValue: string;
        },
      ) => callback(data);
      ipcRenderer.on('conversation-part-delta', handler);
      return () => {
        ipcRenderer.removeListener('conversation-part-delta', handler);
      };
    },

    /**
     * Listen for context usage updates (emitted when token counts change).
     */
    onContextUsageUpdated: (
      callback: (data: {
        sessionId: string;
        totalTokens: number;
        contextLimit: number;
        usableLimit: number;
        usagePercent: number;
        isNearOverflow: boolean;
        isOverflow: boolean;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string;
          totalTokens: number;
          contextLimit: number;
          usableLimit: number;
          usagePercent: number;
          isNearOverflow: boolean;
          isOverflow: boolean;
        },
      ) => callback(data);
      ipcRenderer.on('context-usage-updated', handler);
      return () => {
        ipcRenderer.removeListener('context-usage-updated', handler);
      };
    },

    /**
     * Listen for compaction events (emitted when a session is compacted).
     *
     * NOTE: This uses addListener instead of removeAllListeners to support
     * multiple React hooks subscribing to the same event (useConversation +
     * useContextUsage both need this). Returns a cleanup function that removes
     * only this specific listener.
     */
    onSessionCompacted: (
      callback: (data: {
        sessionId: string;
        beforeTokens: number;
        afterTokens: number;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string;
          beforeTokens: number;
          afterTokens: number;
        },
      ) => callback(data);
      ipcRenderer.on('session-compacted', handler);
      return () => {
        ipcRenderer.removeListener('session-compacted', handler);
      };
    },
  };
}
