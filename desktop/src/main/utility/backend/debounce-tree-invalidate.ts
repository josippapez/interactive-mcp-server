/**
 * Keyed debouncer for session-tree invalidations.
 *
 * SSE bursts during agent file edits can fire dozens of `session.updated`
 * events per second. Each event used to trigger an immediate
 * `invalidateSessionTree()` call, which in turn fires an IPC event the
 * renderer reacts to with a refetch. Coalescing these into a single
 * trailing-edge call per key amortises the cost.
 *
 * Keying by `providerSessionId` (or any caller-chosen string) ensures bursts
 * on one session do not delay invalidations for unrelated sessions.
 *
 * Implementation notes:
 * - Trailing-edge debounce: every call resets the timer; the action runs
 *   `windowMs` after the last call for that key.
 * - Pure: timers are owned by the returned instance, not module-level state,
 *   so multiple debouncers can coexist (e.g. tests).
 */

export interface KeyedDebouncer {
  /** Schedule `action` for `key`, replacing any pending call for the same key. */
  schedule(key: string, action: () => void): void;
  /** Cancel a pending call for `key`. No-op if none pending. */
  cancel(key: string): void;
  /** Cancel all pending calls. Use during shutdown. */
  cancelAll(): void;
  /** Number of pending keys. Test helper. */
  pendingCount(): number;
}

export interface CreateKeyedDebouncerOptions {
  windowMs: number;
  /** Injected for tests. Defaults to global setTimeout/clearTimeout. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export function createKeyedDebouncer(
  options: CreateKeyedDebouncerOptions,
): KeyedDebouncer {
  const { windowMs } = options;
  const setTimeoutFn =
    options.setTimeoutFn ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));

  const pending = new Map<string, { handle: unknown; action: () => void }>();

  function schedule(key: string, action: () => void): void {
    const existing = pending.get(key);
    if (existing) {
      clearTimeoutFn(existing.handle);
    }
    const handle = setTimeoutFn(() => {
      pending.delete(key);
      action();
    }, windowMs);
    pending.set(key, { handle, action });
  }

  function cancel(key: string): void {
    const existing = pending.get(key);
    if (!existing) return;
    clearTimeoutFn(existing.handle);
    pending.delete(key);
  }

  function cancelAll(): void {
    for (const { handle } of pending.values()) {
      clearTimeoutFn(handle);
    }
    pending.clear();
  }

  function pendingCount(): number {
    return pending.size;
  }

  return { schedule, cancel, cancelAll, pendingCount };
}
