import { ipcRenderer } from 'electron';
import type {
  ConversationBatch,
  PendingQuestionRequest,
  PromptClearData,
  PromptRequest,
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

    // Pull-on-invalidation signal — main process emits this (coalesced ~50ms)
    // whenever the session tree changes. Renderer should respond by calling
    // `window.api.getSessionTree()` to fetch the latest snapshot.
    onSessionTreeInvalidated: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('session-tree-invalidated', handler);
      return () => {
        ipcRenderer.removeListener('session-tree-invalidated', handler);
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
    // ─── Retired listeners (C6) ────────────────────────────────────────────
    // The following channels were removed as part of the streaming rewrite:
    //   todos-updated, opencode-todo-updated, opencode-vcs-updated,
    //   opencode-session-status, conversation-message-event,
    //   conversation-part-event, conversation-part-delta,
    //   context-usage-updated, session-compacted,
    //   opencode-session-idle, opencode-session-error, opencode-file-edited.
    // All live updates now flow through onConversationBatch below.

    /**
     * Subscribe to coalesced `conversation-batch` events from the main
     * event-stream (C1 scaffold). Each batch contains one or more
     * `ConversationEvent`s flushed together (~16ms cadence) and is the
     * sole channel for live message/part/status updates in the new
     * streaming pipeline.
     *
     * Returns a cleanup function; call it in the effect's cleanup phase.
     */
    onConversationBatch: (
      callback: (batch: ConversationBatch) => void,
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        batch: ConversationBatch,
      ) => callback(batch);
      ipcRenderer.on('conversation-batch', handler);
      return () => {
        ipcRenderer.removeListener('conversation-batch', handler);
      };
    },
  };
}
