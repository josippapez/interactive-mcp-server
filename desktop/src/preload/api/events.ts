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
    onPromptRequest: (
      callback: (data: PromptRequest) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: PromptRequest,
      ) => callback(data);
      ipcRenderer.on('prompt-request', handler);
      return () => {
        ipcRenderer.removeListener('prompt-request', handler);
      };
    },
    onPromptClear: (
      callback: (data: PromptClearData) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: PromptClearData,
      ) => callback(data);
      ipcRenderer.on('prompt-clear', handler);
      return () => {
        ipcRenderer.removeListener('prompt-clear', handler);
      };
    },

    // Intensive chat lifecycle
    onIntensiveChatStart: (
      callback: (data: {
        sessionId: string;
        title: string;
        connectionId: string;
        providerSessionId?: string | null;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string;
          title: string;
          connectionId: string;
          providerSessionId?: string | null;
        },
      ) => callback(data);
      ipcRenderer.on('intensive-chat-start', handler);
      return () => {
        ipcRenderer.removeListener('intensive-chat-start', handler);
      };
    },
    onIntensiveChatStop: (
      callback: (data: {
        sessionId: string;
        connectionId: string;
        providerSessionId?: string | null;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string;
          connectionId: string;
          providerSessionId?: string | null;
        },
      ) => callback(data);
      ipcRenderer.on('intensive-chat-stop', handler);
      return () => {
        ipcRenderer.removeListener('intensive-chat-stop', handler);
      };
    },

    // Session tree — full snapshot of all OpenCode sessions + direct connections.
    // Emitted every ~2 s by session-tree-manager and immediately after
    // register_connection or session removal.
    onSessionTreeUpdated: (
      callback: (nodes: SessionTreeNode[]) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: SessionTreeNode[],
      ) => callback(data);
      ipcRenderer.on('session-tree-updated', handler);
      return () => {
        ipcRenderer.removeListener('session-tree-updated', handler);
      };
    },
    onOptimisticSessionNodeCreated: (
      callback: (node: SessionTreeNode) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: SessionTreeNode,
      ) => callback(data);
      ipcRenderer.on('session-node-created-optimistic', handler);
      return () => {
        ipcRenderer.removeListener('session-node-created-optimistic', handler);
      };
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
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          connectionId: string;
          name: string;
          sessionId?: string;
          label?: string;
          providerType?:
            | 'opencode'
            | 'copilot-cli'
            | 'claude-sdk'
            | 'standalone';
        },
      ) => callback(data);
      ipcRenderer.on('connection-opened', handler);
      return () => {
        ipcRenderer.removeListener('connection-opened', handler);
      };
    },
    onConnectionClosed: (
      callback: (data: { connectionId: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { connectionId: string },
      ) => callback(data);
      ipcRenderer.on('connection-closed', handler);
      return () => {
        ipcRenderer.removeListener('connection-closed', handler);
      };
    },
    onChannelLabelUpdated: (
      callback: (data: {
        connectionId: string;
        name: string;
        providerSessionId?: string | null;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          connectionId: string;
          name: string;
          providerSessionId?: string | null;
        },
      ) => callback(data);
      ipcRenderer.on('channel-label-updated', handler);
      return () => {
        ipcRenderer.removeListener('channel-label-updated', handler);
      };
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
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          connectionId: string;
          message: string;
          providerSessionId?: string | null;
        },
      ) => callback(data);
      ipcRenderer.on('agent-message', handler);
      return () => {
        ipcRenderer.removeListener('agent-message', handler);
      };
    },

    // Fired when POST /api/sessions creates a new channel
    onSessionChannelCreated: (
      callback: (data: { sessionId: string; label?: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string; label?: string },
      ) => callback(data);
      ipcRenderer.on('session-channel-created', handler);
      return () => {
        ipcRenderer.removeListener('session-channel-created', handler);
      };
    },

    // Fired when DELETE /api/sessions/:sessionId cleans up a channel
    onSessionChannelDeleted: (
      callback: (data: { sessionId: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string },
      ) => callback(data);
      ipcRenderer.on('session-channel-deleted', handler);
      return () => {
        ipcRenderer.removeListener('session-channel-deleted', handler);
      };
    },
    onSessionChannelMessagesCleared: (
      callback: (data: { sessionId: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionId: string },
      ) => callback(data);
      ipcRenderer.on('session-channel-messages-cleared', handler);
      return () => {
        ipcRenderer.removeListener('session-channel-messages-cleared', handler);
      };
    },

    onDatabaseReset: (
      callback: (data: {
        ok: boolean;
        clearedTables: string[];
        removedIdFiles: number;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          ok: boolean;
          clearedTables: string[];
          removedIdFiles: number;
        },
      ) => callback(data);
      ipcRenderer.on('database-reset', handler);
      return () => {
        ipcRenderer.removeListener('database-reset', handler);
      };
    },

    // Agent-pushed status updates
    onSessionStatusUpdate: (
      callback: (data: {
        connectionId: string;
        status: string;
        type: string;
        providerSessionId?: string | null;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          connectionId: string;
          status: string;
          type: string;
          providerSessionId?: string | null;
        },
      ) => callback(data);
      ipcRenderer.on('session-status-update', handler);
      return () => {
        ipcRenderer.removeListener('session-status-update', handler);
      };
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
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
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
        },
      ) => callback(data);
      ipcRenderer.on('permission-asked', handler);
      return () => {
        ipcRenderer.removeListener('permission-asked', handler);
      };
    },

    onPermissionReplied: (
      callback: (data: {
        sessionID: string;
        requestID: string;
        reply: 'once' | 'always' | 'reject';
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionID: string;
          requestID: string;
          reply: 'once' | 'always' | 'reject';
        },
      ) => callback(data);
      ipcRenderer.on('permission-replied', handler);
      return () => {
        ipcRenderer.removeListener('permission-replied', handler);
      };
    },

    onQuestionAsked: (
      callback: (
        data: PendingQuestionRequest & {
          connectionId: string;
          providerSessionId?: string | null;
        },
      ) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: PendingQuestionRequest & {
          connectionId: string;
          providerSessionId?: string | null;
        },
      ) => callback(data);
      ipcRenderer.on('question-asked', handler);
      return () => {
        ipcRenderer.removeListener('question-asked', handler);
      };
    },

    onQuestionCleared: (
      callback: (data: {
        requestId: string;
        sessionID: string;
        answer?: string;
        rejected?: boolean;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string;
          sessionID: string;
          answer?: string;
          rejected?: boolean;
        },
      ) => callback(data);
      ipcRenderer.on('question-cleared', handler);
      return () => {
        ipcRenderer.removeListener('question-cleared', handler);
      };
    },

    onSkillsUpdated: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('skills-updated', handler);
      return () => {
        ipcRenderer.removeListener('skills-updated', handler);
      };
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
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionId: string;
          todos: {
            content: string;
            status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
            priority: 'high' | 'medium' | 'low';
          }[];
        },
      ) => callback(data);
      ipcRenderer.on('todos-updated', handler);
      return () => {
        ipcRenderer.removeListener('todos-updated', handler);
      };
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
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionID: string;
          todos: {
            id: string;
            content: string;
            status: string;
            priority: string;
          }[];
        },
      ) => callback(data);
      ipcRenderer.on('opencode-todo-updated', handler);
      return () => {
        ipcRenderer.removeListener('opencode-todo-updated', handler);
      };
    },

    /**
     * Real-time VCS branch updates via SSE (vcs.branch.updated event)
     * Replaces polling when available
     */
    onOpenCodeVcsUpdated: (
      callback: (data: { branch: string | null }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { branch: string | null },
      ) => callback(data);
      ipcRenderer.on('opencode-vcs-updated', handler);
      return () => {
        ipcRenderer.removeListener('opencode-vcs-updated', handler);
      };
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

    /**
     * Listen for `session.idle` events from the OpenCode SSE bus.
     *
     * Signals that a session has finished processing its current turn.
     * Complements `onOpenCodeSessionStatus` (which also reports idle/busy)
     * but fires once per transition rather than on every status change.
     *
     * Returns a cleanup function; call it in the effect's cleanup phase.
     */
    onOpenCodeSessionIdle: (
      callback: (data: { sessionID: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { sessionID: string },
      ) => callback(data);
      ipcRenderer.on('opencode-session-idle', handler);
      return () => {
        ipcRenderer.removeListener('opencode-session-idle', handler);
      };
    },

    /**
     * Listen for `session.error` events from the OpenCode SSE bus.
     *
     * The `error` payload is a discriminated union in the v2 SDK
     * (ProviderAuthError, ContextOverflowError, ApiError, etc.). It is
     * forwarded opaquely so the renderer can branch on `error.name` and
     * read subtype-specific fields from `error.data` without this layer
     * needing to know every variant.
     *
     * Returns a cleanup function; call it in the effect's cleanup phase.
     */
    onOpenCodeSessionError: (
      callback: (data: {
        sessionID: string | null;
        error: { name?: string; data?: Record<string, unknown> } | null;
      }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          sessionID: string | null;
          error: { name?: string; data?: Record<string, unknown> } | null;
        },
      ) => callback(data);
      ipcRenderer.on('opencode-session-error', handler);
      return () => {
        ipcRenderer.removeListener('opencode-session-error', handler);
      };
    },

    /**
     * Listen for `file.edited` events from the OpenCode SSE bus.
     *
     * Fires when OpenCode (or a tool acting through it) edits a file on
     * disk. `directory` is the project directory the event was emitted
     * under (per the v2 `GlobalEvent` envelope) and may be null for
     * global events.
     *
     * Returns a cleanup function; call it in the effect's cleanup phase.
     */
    onOpenCodeFileEdited: (
      callback: (data: { directory: string | null; file: string }) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { directory: string | null; file: string },
      ) => callback(data);
      ipcRenderer.on('opencode-file-edited', handler);
      return () => {
        ipcRenderer.removeListener('opencode-file-edited', handler);
      };
    },
  };
}
