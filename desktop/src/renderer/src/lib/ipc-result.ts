/**
 * Shared types and pure helpers for consuming the main-process IPC result
 * envelope: `{ ok: true, data } | { ok: false, error }`.
 *
 * These helpers are pure and framework-agnostic — they are consumed by React
 * hooks (see `hooks/useIpcQuery.ts`, `hooks/useIpcMutation.ts`) as well as any
 * renderer-side plain-async call site that wants to surface typed errors.
 */

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Type guard: narrows an `IpcResult<T>` to the success variant.
 */
export function isIpcOk<T>(
  result: IpcResult<T>,
): result is { ok: true; data: T } {
  return result.ok === true;
}

/**
 * Type guard: narrows an `IpcResult<T>` to the error variant.
 */
export function isIpcErr<T>(
  result: IpcResult<T>,
): result is { ok: false; error: string } {
  return result.ok === false;
}

/**
 * Unwrap an `IpcResult<T>` to its inner data, throwing on error.
 *
 * The thrown `Error` preserves the original `IpcResult` on `cause` so the
 * full error envelope remains inspectable in devtools / test assertions.
 */
export function unwrapIpc<T>(result: IpcResult<T>): T {
  if (isIpcOk(result)) {
    return result.data;
  }
  throw new Error(result.error, { cause: result });
}

/**
 * Unwrap an `IpcResult<T>`, falling back to `fallback` on error.
 * Never throws.
 */
export function unwrapIpcOr<T>(result: IpcResult<T>, fallback: T): T {
  return isIpcOk(result) ? result.data : fallback;
}
