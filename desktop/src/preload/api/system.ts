import { ipcRenderer } from 'electron';

export function createSystemApi() {
  return {
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
    openFolderDialog: (): Promise<string | null> =>
      ipcRenderer.invoke('open-folder-dialog'),
    readFileForAttachment: (
      filePath: string,
    ): Promise<{
      type: 'image' | 'text';
      data: string;
      mimeType: string;
      name: string;
      size: number;
    } | null> => ipcRenderer.invoke('read-file-for-attachment', filePath),
    saveClipboardAttachment: (
      sessionKey: string,
      data: string,
      mimeType: string,
    ): Promise<{
      filename: string;
      absolutePath: string;
      url: string | null;
    } | null> =>
      ipcRenderer.invoke('save-clipboard-attachment', {
        sessionKey,
        data,
        mimeType,
      }),

    selectFolderDialog: (): Promise<{
      canceled: boolean;
      folderPath?: string;
    }> => ipcRenderer.invoke('select-folder-dialog'),

    // ─── Renderer Logging ─────────────────────────────────────────────────────
    /**
     * Log a message from the renderer to the main process log file.
     * Use this for routing diagnostics and debugging that need to be persisted.
     */
    log: (
      level: 'debug' | 'info' | 'warn' | 'error',
      category: string,
      message: string,
      sessionId?: string | null,
    ): void => {
      ipcRenderer.send('renderer-log', { level, category, message, sessionId });
    },
  };
}
