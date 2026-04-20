import { useCallback, useEffect, useRef, useState } from 'react';
import type { VcsInfo } from '../types';

type UseVcsInfoResult = {
  vcsInfo: VcsInfo | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const POLL_INTERVAL_MS = 30000; // Poll every 30 seconds (fallback when SSE unavailable)

/**
 * Hook to fetch VCS (git branch) information from the OpenCode server.
 *
 * Uses the dedicated /vcs endpoint which provides accurate branch info,
 * and listens for real-time SSE events (vcs.branch.updated) for instant updates.
 *
 * @param enabled - Whether to enable VCS info fetching
 * @returns Object containing VCS info, loading state, and refresh function
 */
export function useVcsInfo(enabled: boolean = true): UseVcsInfoResult {
  const [vcsInfo, setVcsInfo] = useState<VcsInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const enabledRef = useRef(enabled);
  const hasReceivedSseRef = useRef(false);
  enabledRef.current = enabled;

  const fetchVcs = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) {
      setVcsInfo(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.api.fetchVcsInfo?.();
      if (!enabledRef.current) return;

      if (result) {
        // Map API response to VcsInfo type (which includes additions/deletions/files)
        setVcsInfo({
          branch: result.branch,
          additions: 0, // These will come from session data if needed
          deletions: 0,
          files: 0,
        });
      } else {
        setVcsInfo(null);
      }
    } catch {
      if (!enabledRef.current) return;
      setVcsInfo(null);
    } finally {
      if (enabledRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial fetch and when enabled changes (deferred to idle time)
  useEffect(() => {
    if (!enabled) {
      setVcsInfo(null);
      hasReceivedSseRef.current = false;
      return;
    }

    // Defer non-critical fetch to idle time to prioritize conversation rendering
    const idleCallback =
      'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 50);

    const handle = idleCallback(() => {
      void fetchVcs();
    });

    return () => {
      if ('cancelIdleCallback' in window && typeof handle === 'number') {
        window.cancelIdleCallback(handle);
      }
    };
  }, [enabled, fetchVcs]);

  // Set up polling for VCS info (fallback when SSE unavailable)
  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(() => {
      // Skip polling if we've received SSE events (SSE is working)
      if (hasReceivedSseRef.current) return;
      void fetchVcs();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [enabled, fetchVcs]);

  // Listen for real-time SSE VCS branch updates (vcs.branch.updated event)
  useEffect(() => {
    if (!enabled) return;

    const handler = (data: { branch: string | null }) => {
      hasReceivedSseRef.current = true;
      if (data.branch) {
        setVcsInfo({
          branch: data.branch,
          additions: 0,
          deletions: 0,
          files: 0,
        });
      } else {
        setVcsInfo(null);
      }
    };

    const dispose = window.api.onOpenCodeVcsUpdated?.(handler);

    return () => {
      dispose?.();
    };
  }, [enabled]);

  return {
    vcsInfo,
    isLoading,
    refresh: fetchVcs,
  };
}
