import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpcResult } from '@/lib/ipc-result';
import { runIpcQuery } from './useIpcQuery';

/**
 * Result of `useIpcMutation`.
 */
export interface UseIpcMutationResult<Args extends unknown[], T> {
  /**
   * Invoke the underlying mutator.
   *
   * Resolves to the `data` payload on success, or `null` on error
   * (inspect `error` for the message). Never rejects — errors are
   * always surfaced via the `error` state.
   */
  mutate: (...args: Args) => Promise<T | null>;
  /** Most recent successful payload, or `null`. */
  data: T | null;
  /** Most recent error message, or `null`. */
  error: string | null;
  /** `true` while a mutation is in flight. */
  loading: boolean;
  /** Clears `data` / `error` / `loading`. Does not cancel in-flight work. */
  reset: () => void;
}

/** Internal state object (also used by the pure step reducer below). */
export interface IpcMutationState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export const INITIAL_IPC_MUTATION_STATE: IpcMutationState<never> = {
  data: null,
  error: null,
  loading: false,
};

/**
 * Pure state-transition helpers for the mutation state machine. Exported so
 * they can be unit-tested without React.
 */
export function ipcMutationStart<T>(
  prev: IpcMutationState<T>,
): IpcMutationState<T> {
  return { data: prev.data, error: null, loading: true };
}

export function ipcMutationSettle<T>(
  result: IpcResult<T>,
): IpcMutationState<T> {
  if (result.ok) {
    return { data: result.data, error: null, loading: false };
  }
  return { data: null, error: result.error, loading: false };
}

export function ipcMutationReset<T>(): IpcMutationState<T> {
  return { data: null, error: null, loading: false };
}

/**
 * Manual-invoke mutation hook for the `IpcResult<T>` envelope.
 *
 * Unlike `useIpcQuery`, this hook does NOT fire on mount or on dep change —
 * the caller explicitly invokes `mutate(...)`. Concurrent invocations are
 * handled by always accepting the most-recent settle only (stale responses
 * from an earlier `mutate` call are discarded).
 *
 * @example
 *   const { mutate: writeAgent, loading, error } = useIpcMutation(window.api.writeAgent);
 *   await writeAgent({ scope: 'global', name: 'x' });
 */
export function useIpcMutation<Args extends unknown[], T>(
  mutator: (...args: Args) => Promise<IpcResult<T>>,
): UseIpcMutationResult<Args, T> {
  const [state, setState] = useState<IpcMutationState<T>>(() => ({
    data: null,
    error: null,
    loading: false,
  }));

  const mutatorRef = useRef(mutator);
  mutatorRef.current = mutator;

  const mountedRef = useRef(true);
  const callIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutate = useCallback(async (...args: Args): Promise<T | null> => {
    const myId = ++callIdRef.current;
    setState(ipcMutationStart);

    const result = await runIpcQuery<T>(() => mutatorRef.current(...args));

    if (!mountedRef.current || callIdRef.current !== myId) {
      return result.ok ? result.data : null;
    }

    setState(ipcMutationSettle(result));
    return result.ok ? result.data : null;
  }, []);

  const reset = useCallback(() => {
    setState(ipcMutationReset<T>());
  }, []);

  return {
    mutate,
    data: state.data,
    error: state.error,
    loading: state.loading,
    reset,
  };
}
