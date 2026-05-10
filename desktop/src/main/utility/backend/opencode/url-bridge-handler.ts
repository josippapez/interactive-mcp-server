/**
 * Backend-side bridge handler for `opencode.url.set` events.
 *
 * The main process owns the OpenCode runtime (Mode B/C) and pushes URL
 * (and, for Mode C, Basic-auth password) changes via
 * `supervisor.pushOpenCodeUrl(url, password)` → bridge `emit`. This handler
 * mirrors those updates into the backend-local URL and password subjects
 * so backend SDK clients reading via `getOpenCodeUrl()` /
 * `getOpenCodePassword()` / `waitForOpenCodeUrl()` see the authoritative
 * values.
 *
 * Order matters: password is set BEFORE url so any consumer that wakes
 * via `waitForOpenCodeUrl()` already sees the password before issuing its
 * first authenticated request. Pre-Mode-C payloads (URL only) are still
 * accepted; password defaults to null in that case.
 */

import type { Bridge } from '../../bridge';
import { setOpenCodePasswordGetter } from '../../../../shared/opencode-password-source';
import { getOpenCodePassword, setOpenCodePassword } from './password-subject';
import { setOpenCodeUrl } from './url-subject';

// Register the utility-process password source for the shared SDK cache.
// Idempotent — repeated module loads (HMR/dev) just overwrite with the
// same getter.
setOpenCodePasswordGetter(getOpenCodePassword);

export function registerOpenCodeUrlBridgeHandler(bridge: Bridge): () => void {
  return bridge.on('opencode.url.set', (payload) => {
    if (payload === null || typeof payload !== 'object') {
      console.warn('[opencode.url.set] dropped malformed payload', payload);
      return;
    }
    const { url, password } = payload as {
      url?: unknown;
      password?: unknown;
    };

    // Validate password first — null clears, string sets, undefined leaves
    // unchanged (older payloads). Set BEFORE the url so consumers blocked
    // on `waitForOpenCodeUrl()` already see the password when they wake.
    if (password === null) {
      setOpenCodePassword(null);
    } else if (typeof password === 'string' && password.length > 0) {
      setOpenCodePassword(password);
    } else if (password !== undefined) {
      console.warn(
        '[opencode.url.set] dropped non-string password',
        typeof password,
      );
    }

    if (url === null) {
      setOpenCodeUrl(null);
      return;
    }
    if (typeof url !== 'string' || url.length === 0) {
      console.warn('[opencode.url.set] dropped non-string url', url);
      return;
    }
    console.info(
      `[opencode.url.set] received url=${url} password=${
        typeof password === 'string' ? '<redacted>' : 'unset'
      }`,
    );
    setOpenCodeUrl(url);
  });
}
