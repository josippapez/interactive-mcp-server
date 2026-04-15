import { useState, useEffect, useCallback, useRef } from 'react';

const CONTEXT_USAGE_REFRESH_INTERVAL_MS = 3000;

/** Context/token usage for a session. */
export interface ContextUsage {
  sessionId: string;
  totalTokens: number;
  contextLimit: number;
  usableLimit: number;
  usagePercent: number;
  isNearOverflow: boolean;
  isOverflow: boolean;
  updatedAt?: number;
}

/** Compaction status. */
export type CompactionStatus = 'idle' | 'compacting' | 'success' | 'error';

interface UseContextUsageResult {
  /** Current context usage for the session. */
  usage: ContextUsage | null;
  /** Whether we're currently loading usage data. */
  isLoading: boolean;
  /** Current compaction status. */
  compactionStatus: CompactionStatus;
  /** Error message if compaction failed. */
  compactionError: string | null;
  /** Trigger context compaction. */
  compact: () => Promise<void>;
  /** Refresh usage data from API. */
  refresh: () => Promise<void>;
}

/**
 * Hook to track context/token usage for an OpenCode session.
 *
 * Subscribes to real-time SSE events for usage updates and compaction events.
 * Provides a `compact()` function to trigger manual compaction.
 *
 * @param sessionId - OpenCode session ID (null to disable)
 * @param enabled - Whether to enable tracking (default: true)
 */
export function useContextUsage(
  sessionId: string | null,
  enabled = true,
): UseContextUsageResult {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [compactionStatus, setCompactionStatus] =
    useState<CompactionStatus>('idle');
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const resolvedSessionIdRef = useRef<string | null>(null);

  const resolvedSessionId = useCallback(async (): Promise<string | null> => {
    if (!sessionId || !enabled) return null;

    if (sessionId.startsWith('ses_')) {
      return sessionId;
    }

    try {
      const resolution = await window.api.resolveSession(sessionId);
      if (resolution.providerSessionId?.startsWith('ses_')) {
        return resolution.providerSessionId;
      }
    } catch (err) {
      console.warn(
        '[useContextUsage] Failed to resolve provider session:',
        err,
      );
    }

    return null;
  }, [enabled, sessionId]);

  // Fetch initial usage data
  const refresh = useCallback(async () => {
    if (!enabled) {
      setUsage(null);
      return;
    }

    const targetSessionId = await resolvedSessionId();
    if (!targetSessionId) {
      resolvedSessionIdRef.current = null;
      setUsage(null);
      return;
    }

    resolvedSessionIdRef.current = targetSessionId;

    setIsLoading(true);
    try {
      const result = await window.api.getContextUsage(targetSessionId);
      if (result) {
        resolvedSessionIdRef.current = result.sessionId;
        setUsage(result);
      }
    } catch (err) {
      console.warn('[useContextUsage] Failed to fetch usage:', err);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, resolvedSessionId]);

  // Trigger compaction
  const compact = useCallback(async () => {
    if (compactionStatus === 'compacting') return;

    const targetSessionId = await resolvedSessionId();
    if (!targetSessionId) {
      setCompactionStatus('error');
      setCompactionError('No OpenCode session available for compaction');
      return;
    }

    setCompactionStatus('compacting');
    setCompactionError(null);

    try {
      const result = await window.api.triggerCompaction({
        sessionId: targetSessionId,
      });

      if (result.ok) {
        setCompactionStatus('success');
        // Reset to idle after 2s
        setTimeout(() => setCompactionStatus('idle'), 2000);
      } else {
        setCompactionStatus('error');
        setCompactionError(result.error ?? 'Compaction failed');
      }
    } catch (err) {
      setCompactionStatus('error');
      setCompactionError(
        err instanceof Error ? err.message : 'Compaction failed',
      );
    }
  }, [compactionStatus, resolvedSessionId]);

  // Fetch on mount and when session changes
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep context usage recalculating from the OpenCode source of truth even
  // when no new push event arrives. This matches the "keeps recalculating"
  // behavior more closely and fixes sessions getting stuck after the first read.
  useEffect(() => {
    if (!sessionId || !enabled) return;

    const interval = setInterval(() => {
      void refresh();
    }, CONTEXT_USAGE_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, refresh, sessionId]);

  // Subscribe to real-time usage updates
  useEffect(() => {
    if (!sessionId || !enabled) return;

    const handleUsageUpdate = (data: {
      sessionId: string;
      totalTokens: number;
      contextLimit: number;
      usableLimit: number;
      usagePercent: number;
      isNearOverflow: boolean;
      isOverflow: boolean;
    }) => {
      const targetSessionId = resolvedSessionIdRef.current;
      if (targetSessionId && data.sessionId !== targetSessionId) return;

      setUsage({
        sessionId: data.sessionId,
        totalTokens: data.totalTokens,
        contextLimit: data.contextLimit,
        usableLimit: data.usableLimit,
        usagePercent: data.usagePercent,
        isNearOverflow: data.isNearOverflow,
        isOverflow: data.isOverflow,
        updatedAt: Date.now(),
      });
    };

    const handleCompacted = (data: {
      sessionId: string;
      beforeTokens: number;
      afterTokens: number;
    }) => {
      const targetSessionId = resolvedSessionIdRef.current;
      if (targetSessionId && data.sessionId !== targetSessionId) return;

      // Compaction completed successfully
      setCompactionStatus('success');
      void refresh();
      setTimeout(() => setCompactionStatus('idle'), 2000);
    };

    const cleanupUsage = window.api.onContextUsageUpdated(handleUsageUpdate);
    const cleanupCompacted = window.api.onSessionCompacted(handleCompacted);

    // Cleanup the compaction listener when effect re-runs
    return () => {
      cleanupUsage();
      cleanupCompacted();
    };
  }, [sessionId, enabled, refresh]);

  return {
    usage,
    isLoading,
    compactionStatus,
    compactionError,
    compact,
    refresh,
  };
}
