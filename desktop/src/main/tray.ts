import { Tray, Menu, nativeImage } from 'electron';
import { BrowserWindow } from 'electron';

export function createTray(
  getMainWindow: () => BrowserWindow | null,
  quit: () => void,
): Tray {
  // 16×16 chat-bubble icon for macOS menu bar (template image for dark/light mode)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEFSURBVDiNpZMxTgMxEEX/2N4VEg0VR+AYXIBrcBIuwBE4BiWioUOiQuwm9gyFd7NJdpE/ybI8M/6eGdtARHCMmKNYAGjxL/MflnWYiKJZ0nOSrpl9S2J7rMjsGxFNqhpE0TfmvTGz7wFcoHxYYpBUALhA+bDE4BKDSwYZ1uQfAGfgK0mbuRVjHZK0VdI5gFdmPZVkp74G8AjgpW3/RJ+AvJM0V2YBYFPSMwU+UOQo6ZWBewC2JLaSrgBcmA3VGBwCuATQkNhIugZwTqK1mQP4APAB4MnMvnZrVSLiLin0bkqb74bz+1Gq+f+bZub+8SqJJcp2oFfUhqMGcHUvzBwEfYjEK8aN0g9cAAAAASUVORK5CYII=',
  );
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  const tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => getMainWindow()?.show(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => quit(),
    },
  ]);

  tray.setToolTip('Interactive MCP Server');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => getMainWindow()?.show());

  return tray;
}
