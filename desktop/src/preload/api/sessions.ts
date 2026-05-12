import { ipcRenderer } from 'electron';
import type {
  Attachment,
  ConversationRecord,
  PendingPermissionRequest,
  PendingQuestionRequest,
  PromptRequest,
  SessionChannelHistoryRecord,
} from './types';

export function createSessionsApi() {
  return {
    // Prompt handling
    sendPromptResponse: (response: {
      id: string;
      answer: string;
      attachments?: Attachment[];
    }) => {
      ipcRenderer.send('prompt-response', response);
    },

    // History
    getHistory: (): Promise<ConversationRecord[]> =>
      ipcRenderer.invoke('get-history'),
    clearHistory: (): Promise<boolean> => ipcRenderer.invoke('clear-history'),
    resetDatabase: (): Promise<{
      ok: boolean;
      clearedTables: string[];
      removedIdFiles: number;
    }> => ipcRenderer.invoke('reset-database'),

    // Return all currently-active prompts so the renderer can recover them on startup.
    getActivePrompts: (): Promise<PromptRequest[]> =>
      ipcRenderer.invoke('get-active-prompts'),
    getPendingPermissions: (
      baseDirectory?: string,
    ): Promise<PendingPermissionRequest[]> =>
      ipcRenderer.invoke('get-pending-permissions', baseDirectory),
    getPendingQuestions: (): Promise<PendingQuestionRequest[]> =>
      ipcRenderer.invoke('get-pending-questions'),
    dismissSession: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke('dismiss-session', connectionId),
    forceTerminateChat: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke('force-terminate-chat', connectionId),

    getPersistedSessionChannels: (): Promise<
      {
        sessionId: string;
        label: string | null;
        createdAt: string;
        providerSessionId: string | null;
        parentSessionId: string | null;
      }[]
    > => ipcRenderer.invoke('get-persisted-session-channels'),
    getSessionChannelHistory: (
      sessionId: string,
    ): Promise<SessionChannelHistoryRecord[]> =>
      ipcRenderer.invoke('get-session-channel-history', sessionId),
    getSessionLogPath: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('get-session-log-path', sessionId),
    readSessionLog: (sessionId: string, lines?: number): Promise<string> =>
      ipcRenderer.invoke('read-session-log', sessionId, lines),
    openSessionLog: (
      sessionId: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('open-session-log', sessionId),
    clearSessionChannelMessages: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('clear-session-channel-messages', sessionId),
    removeSessionChannel: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('remove-session-channel', sessionId),

    // Session channel — queue a message for the agent (persisted in SQLite)
    queueSessionMessage: (sessionId: string, message: string): void => {
      ipcRenderer.send('queue-session-message', { sessionId, message });
    },

    // Permission / question replies
    replyPermission: (
      sessionID: string,
      requestID: string,
      reply: 'once' | 'always' | 'reject',
      directory?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('reply-permission', {
        sessionID,
        requestID,
        reply,
        directory,
      }),
    replyQuestion: (
      requestID: string,
      answers: string[][],
      sessionID: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('reply-question', { requestID, answers, sessionID }),
    rejectQuestion: (
      requestID: string,
      sessionID: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('reject-question', { requestID, sessionID }),

    // ─── Global Search ─────────────────────────────────────────────────────────
    searchGlobal: (
      query: string,
      options?: { sessionLimit?: number; messageLimit?: number },
    ): Promise<{
      sessions: {
        sessionId: string;
        channelName: string;
        projectName: string;
        createdAt: string;
        updatedAt: string;
      }[];
      messages: {
        id: number;
        sessionId: string;
        sessionName: string;
        messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
        messageText: string;
        snippet: string;
        createdAt: string;
      }[];
    }> =>
      ipcRenderer.invoke('search-global', {
        query,
        sessionLimit: options?.sessionLimit,
        messageLimit: options?.messageLimit,
      }),

    // ─── Conversation Mirroring ─────────────────────────────────────────────────

    /**
     * Fetch conversation messages for a session.
     * Returns messages from the conversation provider (e.g., OpenCode).
     */
    fetchConversationMessages: (
      sessionId: string,
      opts?: { limit?: number; before?: string },
    ): Promise<import('./types').ConversationMessage[]> =>
      ipcRenderer.invoke('fetch-conversation-messages', {
        sessionId,
        limit: opts?.limit,
        before: opts?.before,
      }),

    /**
     * Check if conversation provider is available.
     */
    isConversationAvailable: (providerId?: string): Promise<boolean> =>
      ipcRenderer.invoke('is-conversation-available', providerId),

    // ─── Context Tracking ─────────────────────────────────────────────────────────

    /**
     * Get current context/token usage for a session.
     */
    getContextUsage: (
      sessionId: string,
    ): Promise<{
      sessionId: string;
      totalTokens: number;
      contextLimit: number;
      usableLimit: number;
      usagePercent: number;
      isNearOverflow: boolean;
      isOverflow: boolean;
      updatedAt: number;
    } | null> => ipcRenderer.invoke('get-context-usage', sessionId),

    /**
     * Trigger context compaction for a session.
     */
    triggerCompaction: (options: {
      sessionId: string;
      providerId?: string;
      modelId?: string;
    }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('trigger-compaction', options),

    /**
     * Fetch current token count for a session from OpenCode API.
     */
    fetchSessionTokens: (
      sessionId: string,
    ): Promise<{
      id: string;
      tokens?: number;
      modelId?: string;
    } | null> => ipcRenderer.invoke('fetch-session-tokens', sessionId),
  };
}
