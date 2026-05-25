import { Notification, dialog, shell } from 'electron';
import type { BrowserWindow } from 'electron';

type PermissionNotificationPayload = {
  sessionID?: string;
  permission: string;
  metadata?: Record<string, unknown>;
  patterns?: string[];
};

type QuestionNotificationPayload = {
  sessionID?: string;
  questions: Array<{ question?: unknown; header?: unknown }>;
};

type PromptNotificationClickPayload = {
  providerSessionId: string;
};

type NotificationPermissionState = 'default' | 'denied' | 'granted';

const requestNotificationPermissionScript = `
(() => {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
})()
`;

let notificationSettingsPromptShown = false;

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function basename(path: string | null): string | null {
  if (!path) return null;
  return path.replace(/^.*\/([^/]+)$/, '$1');
}

export function getPermissionNotificationText(
  payload: PermissionNotificationPayload,
): { title: string; body: string } {
  const metadata = payload.metadata ?? {};
  const permission = payload.permission.toLowerCase();

  if (permission === 'bash') {
    return {
      title: 'Permission requested',
      body: getString(metadata.description) ?? 'Allow shell command?',
    };
  }

  if (permission === 'read') {
    const path = payload.patterns?.[0] ?? null;
    return {
      title: 'Permission requested',
      body: `Allow reading ${basename(path) ?? 'a file'}?`,
    };
  }

  if (permission === 'edit') {
    const filepath = getString(metadata.filepath);
    return {
      title: 'Permission requested',
      body: `Allow editing ${basename(filepath) ?? 'a file'}?`,
    };
  }

  return {
    title: 'Permission requested',
    body: `Allow ${payload.permission}?`,
  };
}

export function getQuestionNotificationText(
  payload: QuestionNotificationPayload,
): { title: string; body: string } {
  if (payload.questions.length > 1) {
    return {
      title: 'Question requested',
      body: `${payload.questions.length} questions need your input`,
    };
  }

  const firstQuestion = getString(payload.questions[0]?.question);

  if (firstQuestion) {
    return {
      title: 'Question requested',
      body: firstQuestion,
    };
  }

  return {
    title: 'Question requested',
    body: 'An agent needs your input',
  };
}

export function shouldNotifyForPermissionRequest(
  _win: Pick<BrowserWindow, 'isFocused' | 'isVisible'> | null | undefined,
): boolean {
  void _win;
  return true;
}

export function shouldRequestNotificationPermission(
  platform: NodeJS.Platform,
  permission: NotificationPermissionState,
): boolean {
  return platform === 'darwin' && permission === 'default';
}

export function shouldShowNotificationSettingsPrompt(
  platform: NodeJS.Platform,
  permission: NotificationPermissionState,
  alreadyShown: boolean,
): boolean {
  return platform === 'darwin' && permission === 'denied' && !alreadyShown;
}

export function buildPromptNotificationClickPayload(
  providerSessionId: string | null | undefined,
): PromptNotificationClickPayload | null {
  if (!providerSessionId) return null;
  return { providerSessionId };
}

function openNotificationSettings(): void {
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  );
}

async function showNotificationSettingsPrompt(
  win: BrowserWindow | null | undefined,
): Promise<void> {
  if (!win || win.isDestroyed()) return;

  const response = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Open Settings', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Notifications are disabled for Eden',
    detail:
      'Eden needs macOS notification permission to alert you when an agent is waiting for approval.',
  });

  if (response.response === 0) {
    openNotificationSettings();
  }
}

async function ensureNativeNotificationPermission(
  win: BrowserWindow | null | undefined,
): Promise<boolean> {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return true;

  try {
    const permission = (await win.webContents.executeJavaScript(
      requestNotificationPermissionScript,
      true,
    )) as NotificationPermissionState;
    if (
      shouldShowNotificationSettingsPrompt(
        process.platform,
        permission,
        notificationSettingsPromptShown,
      )
    ) {
      notificationSettingsPromptShown = true;
      void showNotificationSettingsPrompt(win);
    }

    return permission === 'granted';
  } catch {
    // If the renderer is not ready, still try the main-process notification.
    return true;
  }
}

export function requestNativeNotificationPermission(
  win: BrowserWindow | null | undefined,
): void {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return;

  void win.webContents
    .executeJavaScript(requestNotificationPermissionScript, true)
    .catch(() => {
      // Non-fatal: permission will be retried when the first prompt arrives.
    });
}

function showNativePromptNotification(
  win: BrowserWindow | null | undefined,
  text: { title: string; body: string },
  providerSessionId?: string,
): void {
  if (!Notification.isSupported()) {
    return;
  }

  void ensureNativeNotificationPermission(win).then((hasPermission) => {
    if (!hasPermission) return;

    const notification = new Notification({
      ...text,
      silent: false,
    });

    notification.on('click', () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      win.focus();
      const clickPayload =
        buildPromptNotificationClickPayload(providerSessionId);
      if (clickPayload) {
        win.webContents.send('prompt-notification-clicked', clickPayload);
      }
    });

    notification.show();
  });
}

export function showPermissionNotification(
  win: BrowserWindow | null | undefined,
  payload: PermissionNotificationPayload,
): void {
  if (!shouldNotifyForPermissionRequest(win)) {
    return;
  }

  showNativePromptNotification(
    win,
    getPermissionNotificationText(payload),
    payload.sessionID,
  );
}

export function showQuestionNotification(
  win: BrowserWindow | null | undefined,
  payload: QuestionNotificationPayload,
): void {
  showNativePromptNotification(
    win,
    getQuestionNotificationText(payload),
    payload.sessionID,
  );
}
