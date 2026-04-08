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
  baseDirectory?: string;
  clientInfo?: { model?: string; mode?: string };
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
};

const api = {
  // Prompt handling
  onPromptRequest: (callback: (data: PromptRequest) => void) => {
    ipcRenderer.on('prompt-request', (_event, data) => callback(data));
  },
  onPromptClear: (
    callback: (data: { id: string; connectionId: string }) => void,
  ) => {
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
    }) => void,
  ) => {
    ipcRenderer.on('intensive-chat-start', (_event, data) => callback(data));
  },
  onIntensiveChatStop: (
    callback: (data: { sessionId: string; connectionId: string }) => void,
  ) => {
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
        agentName: string | null;
        hasMcpChannel: boolean;
        baseDirectory: string | null;
        registeredParentSessionId: string | null;
      }[],
    ) => void,
  ) => {
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
    ipcRenderer.on('connection-opened', (_event, data) => callback(data));
  },
  onConnectionClosed: (callback: (data: { connectionId: string }) => void) => {
    ipcRenderer.on('connection-closed', (_event, data) => callback(data));
  },

  // History
  getHistory: (): Promise<ConversationRecord[]> =>
    ipcRenderer.invoke('get-history'),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('clear-history'),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke('save-settings', settings),

  // Server status
  getServerStatus: (): Promise<{ running: boolean; port: number }> =>
    ipcRenderer.invoke('get-server-status'),

  // App version
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // Detect the active OpenCode session on demand (best-effort)
  detectOpenCodeSession: (baseDirectory?: string): Promise<string | null> =>
    ipcRenderer.invoke('detect-opencode-session', baseDirectory),

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
    callback: (data: { connectionId: string; message: string }) => void,
  ): void => {
    ipcRenderer.on('agent-message', (_event, data) => callback(data));
  },

  // Fired when POST /api/sessions creates a new channel
  onSessionChannelCreated: (
    callback: (data: { sessionId: string; label?: string }) => void,
  ): void => {
    ipcRenderer.on('session-channel-created', (_event, data) => callback(data));
  },

  // Fired when DELETE /api/sessions/:sessionId cleans up a channel
  onSessionChannelDeleted: (
    callback: (data: { sessionId: string }) => void,
  ): void => {
    ipcRenderer.on('session-channel-deleted', (_event, data) => callback(data));
  },
  onSessionChannelMessagesCleared: (
    callback: (data: { sessionId: string }) => void,
  ): void => {
    ipcRenderer.on('session-channel-messages-cleared', (_event, data) =>
      callback(data),
    );
  },

  // Agent-pushed status updates
  onSessionStatusUpdate: (
    callback: (data: {
      connectionId: string;
      status: string;
      type: string;
    }) => void,
  ): void => {
    ipcRenderer.on('session-status-update', (_event, data) => callback(data));
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
