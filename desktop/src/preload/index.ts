import { contextBridge, ipcRenderer } from 'electron';

export type PromptRequest = {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  /** Unix ms timestamp when this prompt expires. 0 means no timeout. */
  expiresAt: number;
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
  /** OpenCode session ID resolved from the DB — used by the renderer to find
   *  the correct channel node after app restart when connectionIds may have changed. */
  openCodeSessionId?: string | null;
};

export type Attachment = {
  data: string;
  mimeType: string;
  name: string;
  size: number;
};

export type ConversationRecord = {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  attachments: string | null;
  createdAt: string;
};

export type SessionChannelHistoryRecord = {
  id: number;
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
};

export type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  autoStartOpenCode: boolean;
  autoSyncOpencode: boolean;
  docContextDebug: boolean;
  agentBackend: 'standalone' | 'opencode' | 'claude_sdk';
  autoRegisterSubagents: boolean;
};

export type ProviderStatus = {
  backend: 'standalone' | 'opencode' | 'claude_sdk';
  effectiveMode: 'standalone' | 'opencode' | 'claude_sdk' | 'standalone_compat';
  supportsSessionHierarchy: boolean;
  supportsProviderInjection: boolean;
  runtime: {
    available: boolean;
    reason?: 'module_not_installed' | 'missing_api_key' | 'init_failed';
    message: string;
  } | null;
};

export type SkillOrInstructionRecord = {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

const api = {
  // Prompt handling
  onPromptRequest: (callback: (data: PromptRequest) => void) => {
    ipcRenderer.removeAllListeners('prompt-request');
    ipcRenderer.on('prompt-request', (_event, data) => callback(data));
  },
  onPromptClear: (
    callback: (data: {
      id: string;
      connectionId: string;
      openCodeSessionId?: string | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('prompt-clear');
    ipcRenderer.on('prompt-clear', (_event, data) => callback(data));
  },
  sendPromptResponse: (response: {
    id: string;
    answer: string;
    attachments?: Attachment[];
  }) => {
    ipcRenderer.send('prompt-response', response);
  },

  // Intensive chat lifecycle
  onIntensiveChatStart: (
    callback: (data: {
      sessionId: string;
      title: string;
      connectionId: string;
      openCodeSessionId?: string | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('intensive-chat-start');
    ipcRenderer.on('intensive-chat-start', (_event, data) => callback(data));
  },
  onIntensiveChatStop: (
    callback: (data: {
      sessionId: string;
      connectionId: string;
      openCodeSessionId?: string | null;
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('intensive-chat-stop');
    ipcRenderer.on('intensive-chat-stop', (_event, data) => callback(data));
  },

  // Session tree — full snapshot of all OpenCode sessions + direct connections.
  // Emitted every ~2 s by session-tree-manager and immediately after
  // register_connection or session removal.
  onSessionTreeUpdated: (
    callback: (
      nodes: {
        openCodeSessionId: string;
        openCodeParentId: string | null;
        title: string;
        directory: string;
        createdAt: number;
        updatedAt: number;
        depth: number;
        connectionId: string | null;
        channelName: string | null;
        hasMcpChannel: boolean;
        baseDirectory: string | null;
        registeredParentSessionId: string | null;
      }[],
    ) => void,
  ) => {
    ipcRenderer.removeAllListeners('session-tree-updated');
    ipcRenderer.on('session-tree-updated', (_event, data) => callback(data));
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
    }) => void,
  ) => {
    ipcRenderer.removeAllListeners('connection-opened');
    ipcRenderer.on('connection-opened', (_event, data) => callback(data));
  },
  onConnectionClosed: (callback: (data: { connectionId: string }) => void) => {
    ipcRenderer.removeAllListeners('connection-closed');
    ipcRenderer.on('connection-closed', (_event, data) => callback(data));
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

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke('save-settings', settings),

  // Server status
  getServerStatus: (): Promise<{ running: boolean; port: number }> =>
    ipcRenderer.invoke('get-server-status'),

  // App version
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // Provider backend status/capabilities
  getProviderStatus: (): Promise<ProviderStatus> =>
    ipcRenderer.invoke('get-provider-status'),

  // Detect the active OpenCode session on demand (best-effort)
  detectOpenCodeSession: (baseDirectory?: string): Promise<string | null> =>
    ipcRenderer.invoke('detect-opencode-session', baseDirectory),

  // Provider-agnostic session resolution (connectionId -> provider session ID)
  resolveSession: (
    connectionId: string,
    baseDirectory?: string,
  ): Promise<{
    providerSessionId: string | null;
    parentSessionId: string | null;
    resolvedVia: 'cached' | 're-resolved' | 'ambiguous' | 'none';
    message?: string;
  }> => ipcRenderer.invoke('resolve-session', { connectionId, baseDirectory }),

  // Re-resolve a stale session (clears cache, retries once)
  reResolveSession: (
    connectionId: string,
    baseDirectory?: string,
  ): Promise<{
    providerSessionId: string | null;
    parentSessionId: string | null;
    resolvedVia: 'cached' | 're-resolved' | 'ambiguous' | 'none';
    message?: string;
  }> =>
    ipcRenderer.invoke('re-resolve-session', { connectionId, baseDirectory }),

  // File search for autocomplete
  searchFiles: (baseDirectory: string, query: string): Promise<string[]> =>
    ipcRenderer.invoke('search-files', baseDirectory, query),

  // File dialog and file reading
  openFileDialog: (): Promise<string[]> =>
    ipcRenderer.invoke('open-file-dialog'),
  readFileForAttachment: (
    filePath: string,
  ): Promise<{
    type: 'image' | 'text';
    data: string;
    mimeType: string;
    name: string;
    size: number;
  } | null> => ipcRenderer.invoke('read-file-for-attachment', filePath),
  forceTerminateChat: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke('force-terminate-chat', connectionId),

  // Return all currently-active prompts so the renderer can recover them on startup.
  getActivePrompts: (): Promise<PromptRequest[]> =>
    ipcRenderer.invoke('get-active-prompts'),
  dismissSession: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke('dismiss-session', connectionId),
  restartMcpServer: (): Promise<boolean> =>
    ipcRenderer.invoke('restart-mcp-server'),
  reconnectMcpServer: (): Promise<{ ok: boolean; cleared: number }> =>
    ipcRenderer.invoke('reconnect-mcp-server'),
  getPersistedSessionChannels: (): Promise<
    {
      sessionId: string;
      label: string | null;
      createdAt: string;
      openCodeSessionId: string | null;
      parentSessionId: string | null;
    }[]
  > => ipcRenderer.invoke('get-persisted-session-channels'),
  getSessionChannelHistory: (
    sessionId: string,
  ): Promise<SessionChannelHistoryRecord[]> =>
    ipcRenderer.invoke('get-session-channel-history', sessionId),
  clearSessionChannelMessages: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('clear-session-channel-messages', sessionId),
  removeSessionChannel: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('remove-session-channel', sessionId),

  // Session channel — queue a message for the agent (persisted in SQLite)
  queueSessionMessage: (sessionId: string, message: string): void => {
    ipcRenderer.send('queue-session-message', { sessionId, message });
  },

  // Inject a message into an OpenCode session via its HTTP API
  injectOpenCodeMessage: (
    openCodeSessionId: string,
    message: string,
    attachments?: Attachment[],
  ): Promise<{ ok: boolean; error?: string; noReply?: boolean }> =>
    ipcRenderer.invoke('inject-opencode-message', {
      openCodeSessionId,
      message,
      attachments,
    }),

  injectClaudeMessage: (
    connectionId: string,
    message: string,
    baseDirectory?: string,
    attachments?: Attachment[],
  ): Promise<{
    ok: boolean;
    sessionId?: string;
    responseText?: string;
    error?: string;
  }> =>
    ipcRenderer.invoke('inject-claude-message', {
      connectionId,
      message,
      baseDirectory,
      attachments,
    }),

  // Inject relevant repository doc context into OpenCode before a user message
  injectDocContext: (
    connectionId: string,
    openCodeSessionId: string,
    message: string,
    baseDirectory?: string,
  ): Promise<{ ok: boolean; injectedCount: number; error?: string }> =>
    ipcRenderer.invoke('inject-doc-context', {
      connectionId,
      openCodeSessionId,
      message,
      baseDirectory,
    }),

  // Manually trigger OpenCode config sync (register MCP server + update config file)
  syncOpencodeConfig: (): Promise<string> =>
    ipcRenderer.invoke('sync-opencode-config'),

  // Fired when the agent sends a message via send_message tool
  onAgentMessage: (
    callback: (data: {
      connectionId: string;
      message: string;
      openCodeSessionId?: string | null;
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
    ipcRenderer.on('session-channel-created', (_event, data) => callback(data));
  },

  // Fired when DELETE /api/sessions/:sessionId cleans up a channel
  onSessionChannelDeleted: (
    callback: (data: { sessionId: string }) => void,
  ): void => {
    ipcRenderer.removeAllListeners('session-channel-deleted');
    ipcRenderer.on('session-channel-deleted', (_event, data) => callback(data));
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
      openCodeSessionId?: string | null;
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
      permission: string;
      patterns?: string[];
      always?: boolean;
      tool?: { messageID: string; callID: string };
      metadata?: Record<string, unknown>;
      openCodeSessionId?: string | null;
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

  replyPermission: (
    sessionID: string,
    requestID: string,
    reply: 'once' | 'always' | 'reject',
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('reply-permission', { sessionID, requestID, reply }),

  // Skills & Instructions CRUD
  upsertSkillOrInstruction: (data: {
    name: string;
    type: 'skill' | 'instruction';
    description: string;
    content: string;
  }): Promise<SkillOrInstructionRecord | null> =>
    ipcRenderer.invoke('upsert-skill-or-instruction', data),
  listSkillsAndInstructions: (
    filterType?: 'skill' | 'instruction',
  ): Promise<SkillOrInstructionRecord[]> =>
    ipcRenderer.invoke('list-skills-and-instructions', filterType),
  getSkillOrInstruction: (
    name: string,
  ): Promise<SkillOrInstructionRecord | null> =>
    ipcRenderer.invoke('get-skill-or-instruction', name),
  deleteSkillOrInstruction: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('delete-skill-or-instruction', name),
  onSkillsUpdated: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('skills-updated');
    ipcRenderer.on('skills-updated', () => callback());
  },
  exportSkillsMarkdown: (): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export-skills-markdown'),
  exportSingleSkill: (
    name: string,
  ): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export-single-skill', name),

  // Manually re-seed the session tree cache from the OpenCode REST API
  refreshSessionTree: (): Promise<void> =>
    ipcRenderer.invoke('refresh-session-tree'),
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
