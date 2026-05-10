/**
 * Per-process indirection for the OpenCode Basic-auth password source.
 *
 * The SDK cache (`opencode-sdk-cache.ts`) is a shared module loaded into
 * BOTH the Electron main process and the utility process. Each process
 * has its own password subject (`main/opencode/password-subject.ts` and
 * `main/utility/backend/opencode/password-subject.ts`). This module
 * lets each process register its own getter at startup so the shared
 * cache stays process-agnostic.
 *
 * If no getter is registered, `getOpenCodePassword()` returns `null` —
 * the SDK will then send unauthenticated requests, which is correct for
 * Mode A (in-process server, no password) and tests.
 *
 * Wiring:
 *   - Main process: register in `main/opencode/sdk-client-shim.ts` (or
 *     equivalent bootstrap point that runs before the first SDK call).
 *   - Utility process: register in `main/utility/entry.ts` after the
 *     password subject is wired up.
 */

type PasswordGetter = () => string | null;

let _getter: PasswordGetter | null = null;

export function setOpenCodePasswordGetter(getter: PasswordGetter): void {
  _getter = getter;
}

export function getOpenCodePassword(): string | null {
  if (!_getter) return null;
  try {
    return _getter();
  } catch (err) {
    console.warn('[opencode-password-source] getter threw:', err);
    return null;
  }
}

/** Test-only — clears the registered getter. */
export function __resetPasswordGetter(): void {
  _getter = null;
}
