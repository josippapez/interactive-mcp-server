/**
 * RuntimeUrlSubject — Observer pattern for the OpenCode HTTP server URL.
 *
 * Two identical copies of this file exist:
 *   - `src/main/opencode/url-subject.ts`              (main-side)
 *   - `src/main/utility/backend/opencode/url-subject.ts` (backend-side mirror)
 *
 * They MUST stay byte-for-byte identical. Each process gets its own module
 * instance (separate state). The main → backend bridge propagates updates via
 * the `opencode.url.set` event handled in `url-bridge-handler.ts`.
 *
 * No external imports — pure module-local state.
 */

type UrlSubscriber = (url: string | null) => void;

let currentUrl: string | null = null;
const subscribers = new Set<UrlSubscriber>();

export function setOpenCodeUrl(url: string | null): void {
  if (url === currentUrl) return;
  currentUrl = url;
  // Iterate a snapshot so unsubscribes during dispatch don't skip subscribers.
  for (const cb of [...subscribers]) {
    try {
      cb(currentUrl);
    } catch (err) {
      console.warn('[opencode-url-subject] subscriber threw:', err);
    }
  }
}

export function getOpenCodeUrl(): string | null {
  return currentUrl;
}

export function subscribeOpenCodeUrl(cb: UrlSubscriber): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function waitForOpenCodeUrl(timeoutMs = 30_000): Promise<string> {
  if (currentUrl !== null) {
    return Promise.resolve(currentUrl);
  }
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      reject(
        new Error(
          `[opencode-url-subject] waitForOpenCodeUrl timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    timer.unref?.();

    const unsub = subscribeOpenCodeUrl((url) => {
      if (settled) return;
      if (url === null) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(url);
    });
  });
}

/**
 * Test-only helper. Resets module-internal state. Not exported through any
 * public surface — tests import it directly.
 */
export function __resetForTests(): void {
  currentUrl = null;
  subscribers.clear();
}
