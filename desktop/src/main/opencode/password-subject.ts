/**
 * RuntimePasswordSubject — Observer pattern for the OpenCode HTTP server's
 * Basic-auth password. Parallel to `url-subject.ts`, kept structurally
 * identical so the two stay easy to reason about.
 *
 * Two identical copies of this file exist:
 *   - `src/main/opencode/password-subject.ts`              (main-side)
 *   - `src/main/utility/backend/opencode/password-subject.ts` (backend-side mirror)
 *
 * They MUST stay byte-for-byte identical. Each process gets its own module
 * instance (separate state). The main → backend bridge propagates updates via
 * the `opencode.url.set` event handled in `url-bridge-handler.ts` (the bridge
 * payload was extended additively to include `password`; one event covers
 * both fields so the bridge handler can set them atomically with password
 * BEFORE url to close the auth race for downstream `waitForOpenCodeUrl`
 * consumers).
 *
 * No external imports — pure module-local state.
 */

type PasswordSubscriber = (password: string | null) => void;

let currentPassword: string | null = null;
const subscribers = new Set<PasswordSubscriber>();

export function setOpenCodePassword(password: string | null): void {
  if (password === currentPassword) return;
  currentPassword = password;
  for (const cb of [...subscribers]) {
    try {
      cb(currentPassword);
    } catch (err) {
      console.warn('[opencode-password-subject] subscriber threw:', err);
    }
  }
}

export function getOpenCodePassword(): string | null {
  return currentPassword;
}

export function subscribeOpenCodePassword(cb: PasswordSubscriber): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Test-only helper. Resets module-internal state. Not exported through any
 * public surface — tests import it directly.
 */
export function __resetForTests(): void {
  currentPassword = null;
  subscribers.clear();
}
