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
};

export type ConversationRecord = {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  createdAt: string;
};

export type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
};

const api = {
  // Prompt handling
  onPromptRequest: (callback: (data: PromptRequest) => void) => {
    ipcRenderer.on('prompt-request', (_event, data) => callback(data));
  },
  sendPromptResponse: (response: { id: string; answer: string }) => {
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
    callback: (data: { connectionId: string; name: string }) => void,
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

  // File search for autocomplete
  searchFiles: (baseDirectory: string, query: string): Promise<string[]> =>
    ipcRenderer.invoke('search-files', baseDirectory, query),
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
