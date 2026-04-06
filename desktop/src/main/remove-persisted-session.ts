import type { BrowserWindow } from 'electron';

export interface RemovePersistedSessionDeps {
  getWindow: () => BrowserWindow | null;
  getOpenCodePort: () => number;
  forceTerminateChat: (connectionId: string) => void;
  closeSessionByConnectionId: (connectionId: string) => Promise<boolean>;
  deleteSessionChannel: (sessionId: string) => void;
  deleteRegisteredConnection: (connectionId: string) => void;
  markConnectionDeleted: (connectionId: string) => void;
  triggerSessionTreeUpdate: (
    getWindow: () => BrowserWindow | null,
    getOpenCodePort: () => number,
  ) => void | Promise<void>;
}

export function removePersistedSession(
  sessionId: string,
  deps: RemovePersistedSessionDeps,
): boolean {
  deps.forceTerminateChat(sessionId);
  void deps.closeSessionByConnectionId(sessionId);
  deps.deleteSessionChannel(sessionId);
  deps.deleteRegisteredConnection(sessionId);
  deps.markConnectionDeleted(sessionId);
  void deps.triggerSessionTreeUpdate(deps.getWindow, deps.getOpenCodePort);
  deps.getWindow()?.webContents.send('connection-closed', {
    connectionId: sessionId,
  });
  deps.getWindow()?.webContents.send('session-channel-deleted', { sessionId });
  return true;
}
