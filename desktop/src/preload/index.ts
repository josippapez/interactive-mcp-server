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
};

const api = {
  // Prompt handling
  onPromptRequest: (callback: (data: PromptRequest) => void) => {
    ipcRenderer.on('prompt-request', (_event, data) => callback(data));
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

  // Connection lifecycle
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
  onConnectionRegistered: (
    callback: (data: {
      connectionId: string;
      agentName: string;
      projectName: string;
      baseDirectory: string | null;
      label: string;
      openCodeSessionId: string | null;
    }) => void,
  ) => {
    ipcRenderer.on('connection-registered', (_event, data) => callback(data));
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
    fetch(`http://localhost:3100/api/reconnect`, { method: 'POST' }).then((r) =>
      r.json(),
    ),
  getPersistedSessionChannels: (): Promise<
    { sessionId: string; label: string | null; createdAt: string }[]
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

  // Inject a message into an OpenCode session (visible in session log, no agent response triggered)
  injectOpenCodeMessage: (
    openCodeSessionId: string,
    message: string,
    attachments?: Attachment[],
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('inject-opencode-message', {
      openCodeSessionId,
      message,
      attachments,
    }),

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
