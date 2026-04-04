/**
 * Minimal Electron mock for vitest.
 * Only stubs the APIs actually imported by main-process modules under test.
 */

export const app = {
  getPath: () => '/tmp',
  getVersion: () => '0.0.0-test',
  setLoginItemSettings: () => {},
  getLoginItemSettings: () => ({ wasOpenedAtLogin: false }),
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {},
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {},
};

export const ipcRenderer = {
  invoke: () => Promise.resolve(null),
  send: () => {},
  on: () => {},
};

export const BrowserWindow = class {
  webContents = { send: () => {} };
  show(): void {}
  hide(): void {}
};

export const Tray = class {};
export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
};
export const contextBridge = { exposeInMainWorld: () => {} };

export const electronApp = { setAppUserModelId: () => {} };
export const optimizer = { watchWindowShortcuts: () => {} };
