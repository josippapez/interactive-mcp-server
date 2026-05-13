/**
 * Race a promise against a timeout. Mirrors upstream OpenCode's
 * `packages/opencode/src/util/timeout.ts` pattern.
 *
 * Used to bound MCP registration calls so a single hanging server cannot
 * stall an entire batch even if its underlying transport ignores AbortSignal.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(label ?? `Operation timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]);
}
