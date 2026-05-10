/**
 * Dev-only userData pinning.
 *
 * Why: in dev (`electron-vite dev`) Electron derives userData from
 * `package.json#name`, so dev writes to `~/Library/Application Support/eden-desktop/`
 * while production (`productName: "Eden"`) writes to `~/Library/Application Support/Eden/`.
 * That gives us two separate `conversations.db` files and two separate
 * OpenCode `XDG_STATE_HOME` directories — dev cannot see prod sessions and
 * vice-versa.
 *
 * Production builds keep their natural path (no override). Only dev pins
 * to the canonical "Eden" location so a developer can debug against real
 * production session history.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pin Electron's userData path to a stable target in dev only.
 *
 * MUST be called before `app.whenReady()` and before any subsystem that
 * reads `app.getPath('userData')`. Caller is responsible for guarding on
 * `!app.isPackaged`.
 *
 * Returns the resolved path actually used (target on success, original
 * default on failure). Failure is non-fatal — we log and continue with
 * Electron's default.
 */
export function pinDevUserData(opts: {
  appSetPath: (key: 'userData', value: string) => void;
  appGetPath: (key: 'userData' | 'appData') => string;
  targetName: string; // e.g. "Eden"
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): string {
  const { appSetPath, appGetPath, targetName, log } = opts;

  // appData is the parent of userData (e.g. ~/Library/Application Support).
  const appDataRoot = appGetPath('appData');
  const targetPath = join(appDataRoot, targetName);
  const currentPath = appGetPath('userData');

  // Already pointing at target — nothing to do.
  if (currentPath === targetPath) {
    log.info(`[dev-userdata-pin] already pinned to ${targetPath}`);
    return targetPath;
  }

  try {
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
    appSetPath('userData', targetPath);
    log.info(`[dev-userdata-pin] pinned userData -> ${targetPath}`);
    return targetPath;
  } catch (err) {
    log.warn(
      `[dev-userdata-pin] failed (continuing with default ${currentPath}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return currentPath;
  }
}
