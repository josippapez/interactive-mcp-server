import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Options for configuring the realtime data hook.
 */
export type UseRealtimeDataOptions<T, SseData = T> = {
  /**
   * Whether the hook is enabled. When false, data is cleared and no
   * fetching/SSE occurs.
   */
  enabled: boolean;

  /**
   * Function to fetch initial data and periodic polling fallback.
   * Should return null on failure (errors are handled internally).
   */
  fetchFn: () => Promise<T | null>;

  /**
   * Function to register an SSE listener. Returns an optional cleanup
   * function. If no cleanup is returned, the hook assumes the listener
   * is managed externally (e.g., by the preload script).
   */
  sseFn?: (handler: (data: SseData) => void) => (() => void) | void;

  /**
   * Transform SSE data to the state type T.
   * If not provided, SSE data is cast directly to T.
   */
  transformSse?: (sseData: SseData) => T;

  /**
   * Polling interval in milliseconds. Used as fallback when SSE is unavailable.
   */
  pollIntervalMs: number;

  /**
   * Initial state value before first fetch.
   */
  initialValue: T;

  /**
   * Optional key for resetting state when the key changes.
   * Useful for session-scoped data (e.g., pass sessionId).
   */
  resetKey?: string | null;
};

export type UseRealtimeDataResult<T> = {
  data: T;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

/**
 * A reusable hook that fetches data initially, polls periodically as a
 * fallback, and listens for SSE updates when available.
 *
 * SSE reception automatically disables polling (SSE is considered more
 * efficient). When the component unmounts or `enabled` becomes false,
 * all listeners and intervals are cleaned up.
 *
 * @example
 * ```typescript
 * const { data, isLoading, refresh } = useRealtimeData({
 *   enabled: Boolean(sessionId),
 *   fetchFn: () => window.api.fetchTodos(sessionId),
 *   sseFn: (handler) => window.api.onTodoUpdated(handler),
 *   transformSse: (sseData) => sseData.todos,
 *   pollIntervalMs: 5000,
 *   initialValue: [],
 *   resetKey: sessionId,
 * });
 * ```
 */
export function useRealtimeData<T, SseData = T>({
  enabled,
  fetchFn,
  sseFn,
  transformSse,
  pollIntervalMs,
  initialValue,
  resetKey,
}: UseRealtimeDataOptions<T, SseData>): UseRealtimeDataResult<T> {
  const [data, setData] = useState<T>(initialValue);
  const [isLoading, setIsLoading] = useState(false);

  // Refs to track current state without triggering effect re-runs
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Track if we've received any SSE events (skip polling when SSE is working)
  const hasReceivedSseRef = useRef(false);

  // Track the current resetKey to detect changes
  const resetKeyRef = useRef(resetKey);

  // Fetch function wrapped in useCallback for stable reference
  const fetchData = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) {
      setData(initialValue);
      return;
    }

    setIsLoading(true);
    try {
      const result = await fetchFn();
      // Guard: check enabled after async operation
      if (!enabledRef.current) return;

      if (result !== null) {
        setData(result);
      } else {
        setData(initialValue);
      }
    } catch {
      if (!enabledRef.current) return;
      setData(initialValue);
    } finally {
      if (enabledRef.current) {
        setIsLoading(false);
      }
    }
  }, [fetchFn, initialValue]);

  // Reset state when resetKey changes
  useEffect(() => {
    if (resetKey !== resetKeyRef.current) {
      resetKeyRef.current = resetKey;
      hasReceivedSseRef.current = false;
      setData(initialValue);
      setIsLoading(false);
    }
  }, [resetKey, initialValue]);

  // Initial fetch and when enabled changes
  useEffect(() => {
    if (!enabled) {
      setData(initialValue);
      hasReceivedSseRef.current = false;
      return;
    }

    void fetchData();
  }, [enabled, fetchData, initialValue]);

  // Polling fallback when SSE is unavailable
  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      // Skip polling if SSE is working
      if (hasReceivedSseRef.current) return;
      void fetchData();
    }, pollIntervalMs);

    return () => clearInterval(intervalId);
  }, [enabled, fetchData, pollIntervalMs]);

  // SSE listener registration with proper cleanup
  useEffect(() => {
    if (!enabled || !sseFn) return;

    const handler = (sseData: SseData) => {
      hasReceivedSseRef.current = true;
      const transformed = transformSse
        ? transformSse(sseData)
        : (sseData as unknown as T);
      setData(transformed);
    };

    const cleanup = sseFn(handler);

    return () => {
      // Call cleanup if provided by the SSE registration function
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [enabled, sseFn, transformSse]);

  return {
    data,
    isLoading,
    refresh: fetchData,
  };
}
