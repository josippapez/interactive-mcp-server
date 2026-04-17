/**
 * Shared IPC result shape and a wrapper that converts thrown errors into
 * `{ ok: false, error }` so handlers don't need to repeat the try/catch
 * boilerplate.
 *
 * The wire shape `{ ok: true, data } | { ok: false, error: string }` is
 * consumed by renderer code; do not change it without also updating preload
 * and renderer call-sites.
 */

import { errorMessage } from '../../utils/errors';

export { errorMessage };

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Wrap an async (or sync) handler so that any thrown value is converted into
 * `{ ok: false, error }` while successful returns are wrapped as
 * `{ ok: true, data }`.
 *
 * The original error is not rethrown, but `errorMessage` preserves the
 * `Error.message` string. Callers that need the original cause should throw
 * an `Error` (which carries its own message) rather than a bare string.
 */
export function withIpcResult<A extends unknown[], T>(
  fn: (...args: A) => Promise<T> | T,
): (...args: A) => Promise<IpcResult<T>> {
  return async (...args: A): Promise<IpcResult<T>> => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  };
}
