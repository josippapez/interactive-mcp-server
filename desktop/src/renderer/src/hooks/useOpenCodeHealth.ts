import { useCallback, useEffect, useRef, useState } from 'react';

export type OpenCodeHealthStatus = {
  available: boolean;
  healthy: boolean;
  version: string | null;
  error?: string;
};

type UseOpenCodeHealthResult = {
  status: OpenCodeHealthStatus;
  isChecking: boolean;
  refresh: () => Promise<void>;
};

const POLL_INTERVAL_MS = 10000; // Poll every 10 seconds

/**
 * Hook to monitor OpenCode server health status.
 *
 * @param enabled - Whether to enable health monitoring (disabled if not using OpenCode backend)
 * @returns Object containing health status, checking state, and refresh function
 */
export function useOpenCodeHealth(
  enabled: boolean = true,
): UseOpenCodeHealthResult {
  const [status, setStatus] = useState<OpenCodeHealthStatus>({
    available: false,
    healthy: false,
    version: null,
  });
  const [isChecking, setIsChecking] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const checkHealth = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) {
      setStatus({
        available: false,
        healthy: false,
        version: null,
        error: 'OpenCode backend not enabled',
      });
      return;
    }

    setIsChecking(true);
    try {
      const result = await window.api.checkOpenCodeHealth?.();
      if (!enabledRef.current) return;

      if (result) {
        setStatus(result);
      } else {
        setStatus({
          available: false,
          healthy: false,
          version: null,
          error: 'Health check unavailable',
        });
      }
    } catch (err) {
      if (!enabledRef.current) return;
      setStatus({
        available: false,
        healthy: false,
        version: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      if (enabledRef.current) {
        setIsChecking(false);
      }
    }
  }, []);

  // Initial check and when enabled changes
  useEffect(() => {
    if (!enabled) {
      setStatus({
        available: false,
        healthy: false,
        version: null,
        error: 'OpenCode backend not enabled',
      });
      return;
    }

    void checkHealth();
  }, [enabled, checkHealth]);

  // Set up polling for health checks
  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      void checkHealth();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [enabled, checkHealth]);

  return {
    status,
    isChecking,
    refresh: checkHealth,
  };
}
