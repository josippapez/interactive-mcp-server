/**
 * Global OpenCode health status state using Jotai.
 *
 * This provides a single source of truth for OpenCode server health,
 * eliminating redundant polling when multiple components need health data.
 *
 * Key benefits:
 * - Single polling interval shared across all consumers
 * - Reactive updates across all subscribers
 * - Centralized error handling and status tracking
 */

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** OpenCode health status. */
export interface OpenCodeHealthStatus {
  available: boolean;
  healthy: boolean;
  version: string | null;
  error?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Default poll interval in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 10000;

// -----------------------------------------------------------------------------
// Base Atoms
// -----------------------------------------------------------------------------

/** Current health status. */
export const healthStatusAtom = atom<OpenCodeHealthStatus>({
  available: false,
  healthy: false,
  version: null,
});

/** Whether a health check is currently in progress. */
export const healthCheckingAtom = atom<boolean>(false);

/** Whether health monitoring is enabled. */
export const healthEnabledAtom = atom<boolean>(true);

/** Timestamp of last successful health check. */
export const lastHealthCheckAtom = atom<number | null>(null);

// -----------------------------------------------------------------------------
// Derived Atoms
// -----------------------------------------------------------------------------

/** Combined health state for components that need everything. */
export const healthStateAtom = atom((get) => ({
  status: get(healthStatusAtom),
  isChecking: get(healthCheckingAtom),
  isEnabled: get(healthEnabledAtom),
  lastCheck: get(lastHealthCheckAtom),
}));

// -----------------------------------------------------------------------------
// Action Atoms
// -----------------------------------------------------------------------------

/** Check OpenCode health status. */
export const checkHealthAtom = atom(null, async (get, set) => {
  const enabled = get(healthEnabledAtom);

  if (!enabled) {
    set(healthStatusAtom, {
      available: false,
      healthy: false,
      version: null,
      error: 'OpenCode backend not enabled',
    });
    return;
  }

  set(healthCheckingAtom, true);

  try {
    const result = await window.api.checkOpenCodeHealth?.();

    // Check if still enabled after async call
    if (!get(healthEnabledAtom)) return;

    if (result) {
      set(healthStatusAtom, result);
      set(lastHealthCheckAtom, Date.now());
    } else {
      set(healthStatusAtom, {
        available: false,
        healthy: false,
        version: null,
        error: 'Health check unavailable',
      });
    }
  } catch (err) {
    // Check if still enabled after async call
    if (!get(healthEnabledAtom)) return;

    const message = err instanceof Error ? err.message : 'Unknown error';
    set(healthStatusAtom, {
      available: false,
      healthy: false,
      version: null,
      error: message,
    });
    window.api.log?.('warn', 'health-store', `Health check failed: ${message}`);
  } finally {
    if (get(healthEnabledAtom)) {
      set(healthCheckingAtom, false);
    }
  }
});

/** Set health monitoring enabled state. */
export const setHealthEnabledAtom = atom(
  null,
  (_get, set, enabled: boolean) => {
    set(healthEnabledAtom, enabled);

    if (!enabled) {
      set(healthStatusAtom, {
        available: false,
        healthy: false,
        version: null,
        error: 'OpenCode backend not enabled',
      });
    }
  },
);

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** Get health status (read-only). */
export function useHealthStatus(): OpenCodeHealthStatus {
  return useAtomValue(healthStatusAtom);
}

/** Get checking state (read-only). */
export function useHealthChecking(): boolean {
  return useAtomValue(healthCheckingAtom);
}

/** Get full health state (read-only). */
export function useHealthState(): {
  status: OpenCodeHealthStatus;
  isChecking: boolean;
  isEnabled: boolean;
  lastCheck: number | null;
} {
  return useAtomValue(healthStateAtom);
}

/** Get the check health function (write-only). */
export function useCheckHealth(): () => Promise<void> {
  return useSetAtom(checkHealthAtom);
}

/** Get the set enabled function (write-only). */
export function useSetHealthEnabled(): (enabled: boolean) => void {
  return useSetAtom(setHealthEnabledAtom);
}

/**
 * Backwards-compatible hook matching the old useOpenCodeHealth API.
 *
 * Starts polling on mount when enabled.
 *
 * @param enabled - Whether to enable health monitoring
 * @param pollInterval - Polling interval in milliseconds (default: 10000)
 */
export function useOpenCodeHealth(
  enabled = true,
  pollInterval = DEFAULT_POLL_INTERVAL_MS,
): {
  status: OpenCodeHealthStatus;
  isChecking: boolean;
  refresh: () => Promise<void>;
} {
  const status = useAtomValue(healthStatusAtom);
  const isChecking = useAtomValue(healthCheckingAtom);
  const checkHealth = useSetAtom(checkHealthAtom);
  const setEnabled = useSetAtom(setHealthEnabledAtom);

  // Track enabled state in ref for interval callback
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Sync enabled state to store
  useEffect(() => {
    setEnabled(enabled);
  }, [enabled, setEnabled]);

  // Initial check when enabled
  useEffect(() => {
    if (enabled) {
      void checkHealth();
    }
  }, [enabled, checkHealth]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      if (enabledRef.current) {
        void checkHealth();
      }
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [enabled, pollInterval, checkHealth]);

  return {
    status,
    isChecking,
    refresh: checkHealth,
  };
}
