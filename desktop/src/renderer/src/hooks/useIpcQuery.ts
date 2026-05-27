import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpcResult } from '../lib/ipc-result';

/**
 * Result of `useIpcQuery`.
 */
export interface UseIpcQueryResult<T> {
  /** Last successful payload, or `null` before the first successful fetch. */
  data: T | null;
  /** Error message from the most recent fetch, or `null` when ok/loading. */
  error: string | null;
  /** `true` while a fetch is in flight. */
  loading: boolean;
  /** Re-runs the fetcher with the current closure. */
  refetch: () => void;
}

/**
 * Pure state-machine step for a completed IPC query.
 *
 * Extracted so it can be unit-tested without React. The hook below is a thin
 * wrapper that calls this on each settled promise.
 */
export function reduceIpcQueryResult<T>(result: IpcResult<T>): {
  data: T | null;
  error: string | null;
} {
  if (result.ok) {
    return { data: result.data, error: null };
  }
  return { data: null, error: result.error };
}

/**
 * Pure helper: run a fetcher and translate any thrown error (transport crash,
 * network drop, …) into the same shape as a normal `IpcResult<T>` error.
 *
 * This keeps the hook's error path uniform: whether the renderer IPC bridge
 * resolves `{ ok: false, error }` or rejects with an `Error`, the caller sees
 * one error channel.
 */
export async function runIpcQuery<T>(
  fetcher: () => Promise<IpcResult<T>>,
): Promise<IpcResult<T>> {
  try {
    return await fetcher();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown IPC failure';
    return { ok: false, error: message };
  }
}

/**
 * Fetch-on-mount hook for the `IpcResult<T>` envelope.
 *
 * Re-runs whenever any value in `deps` changes (same semantics as the `deps`
 * array of `useEffect`). A manual `refetch()` is also exposed.
 *
 * Handles the "unmount while pending" case: results that settle after the
 * component unmounts (or after a newer fetch has started) are discarded and
 * do not trigger `setState`.
 *
 * @example
 *   const { data: agents, error, loading, refetch } = useIpcQuery(
 *     () => window.api.listAgents(baseDirectory),
 *     [baseDirectory],
 *   );
 */
export function useIpcQuery<T>(
  fetcher: () => Promise<IpcResult<T>>,
  deps: unknown[],
): UseIpcQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Every fetch increments this; only the result whose id matches the latest
  // id is allowed to flip state. This prevents stale responses from a prior
  // deps change (or from a manual refetch) clobbering fresher data, and
  // covers the "unmount during pending fetch" case via `mountedRef`.
  const fetchIdRef = useRef(0);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Bump this to force a re-fetch without changing caller-provided deps.
  const [refetchTick, setRefetchTick] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTick((t) => t + 1);
  }, []);

  // True unmount tracking — runs once.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    runIpcQuery(fetcherRef.current).then((result) => {
      if (!mountedRef.current || fetchIdRef.current !== myId) {
        return;
      }
      const next = reduceIpcQueryResult(result);
      setData(next.data);
      setError(next.error);
      setLoading(false);
    });
  }, [...deps, refetchTick]);

  return { data, error, loading, refetch };
}
