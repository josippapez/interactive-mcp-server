import { BrowserWindow, shell, nativeImage } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';

export interface CreateWindowOptions {
  startHidden?: boolean;
}

export function createWindow(
  isQuitting: () => boolean,
  options?: CreateWindowOptions,
): BrowserWindow {
  // Load app icon from resources (works cross-platform)
  const iconPath = join(__dirname, '../../resources/icon.png');
  let icon: Electron.NativeImage | undefined;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    // fallback: no custom icon
  }

  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    show: false,
    icon,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  window.on('ready-to-show', () => {
    if (!options?.startHidden) {
      window.show();
    }
  });

  window.on('close', (event) => {
    // If quitting (Cmd+Q or tray Quit), let it close
    if (isQuitting()) return;
    // Otherwise hide to tray
    event.preventDefault();
    window.hide();
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Prevent the renderer from navigating away from the app (e.g. when the
  // user clicks a link that points to a non-app URL such as an attachment
  // asset served from localhost). Any non-app URL is opened in the user's
  // default browser instead so the chat view is never replaced — otherwise
  // there is no "back" UI (titleBarStyle is hiddenInset + autoHideMenuBar).
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    // Allow same-document navigations (hash changes, initial load).
    if (url === currentUrl) return;

    try {
      const target = new URL(url);
      const current = new URL(currentUrl);
      // Allow navigation within the same origin as the loaded app page.
      if (target.origin === current.origin) return;
    } catch {
      // Not a parseable URL — fall through and block.
    }

    event.preventDefault();
    shell.openExternal(url);
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
