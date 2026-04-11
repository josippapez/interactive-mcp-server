import { useCallback, useEffect, useRef, useState } from 'react';

export type SessionStatusType = 'busy' | 'idle' | 'error' | 'unknown';

export type SessionStatusMap = Record<string, { type: SessionStatusType }>;

type UseSessionStatusResult = {
  statusMap: SessionStatusMap;
  isLoading: boolean;
  refresh: () => Promise<void>;
  getStatus: (sessionId: string) => SessionStatusType | null;
};

const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds (fallback when SSE unavailable)

/**
 * Hook to fetch session status from the OpenCode server.
 *
 * Uses the /session/status endpoint which returns status for all sessions
 * in a single call (efficient bulk fetch), and listens for real-time SSE
 * events (session.status) for instant updates.
 *
 * @param enabled - Whether to enable status fetching
 * @returns Object containing status map, loading state, refresh function, and getter
 */
export function useSessionStatus(
  enabled: boolean = true,
): UseSessionStatusResult {
  const [statusMap, setStatusMap] = useState<SessionStatusMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const enabledRef = useRef(enabled);
  const hasReceivedSseRef = useRef(false);
  enabledRef.current = enabled;

  const fetchStatus = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) {
      setStatusMap({});
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.api.fetchSessionStatus?.();
      if (!enabledRef.current) return;

      if (result) {
        setStatusMap(result);
      } else {
        setStatusMap({});
      }
    } catch {
      if (!enabledRef.current) return;
      setStatusMap({});
    } finally {
      if (enabledRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial fetch and when enabled changes
  useEffect(() => {
    if (!enabled) {
      setStatusMap({});
      hasReceivedSseRef.current = false;
      return;
    }

    void fetchStatus();
  }, [enabled, fetchStatus]);

  // Set up polling (fallback when SSE unavailable)
  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      // Skip polling if we've received SSE events (SSE is working)
      if (hasReceivedSseRef.current) return;
      void fetchStatus();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [enabled, fetchStatus]);

  // Listen for real-time SSE session status updates (session.status event)
  useEffect(() => {
    if (!enabled) return;

    const handler = (data: { sessionID: string; status: string }) => {
      hasReceivedSseRef.current = true;
      // Map SSE status string to our SessionStatusType
      const statusType: SessionStatusType =
        data.status === 'busy'
          ? 'busy'
          : data.status === 'idle'
            ? 'idle'
            : data.status === 'error'
              ? 'error'
              : 'unknown';

      setStatusMap((prev) => ({
        ...prev,
        [data.sessionID]: { type: statusType },
      }));
    };

    window.api.onOpenCodeSessionStatus?.(handler);

    return () => {
      // Cleanup handled by preload
    };
  }, [enabled]);

  // Helper to get status for a specific session
  const getStatus = useCallback(
    (sessionId: string): SessionStatusType | null => {
      return statusMap[sessionId]?.type ?? null;
    },
    [statusMap],
  );

  return {
    statusMap,
    isLoading,
    refresh: fetchStatus,
    getStatus,
  };
}
