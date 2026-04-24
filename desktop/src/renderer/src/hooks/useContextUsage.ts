import { useState, useEffect, useCallback, useRef } from 'react';
import {
  seedContextUsageForSession,
  useConversationSelector,
} from '../store/conversation-store';

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

const COMPACTION_RESET_MS = 2000;

/**
 * Hook exposing the context/token usage for an OpenCode session.
 *
 * Live updates arrive via the `context.usage` event on the single
 * `conversation-batch` IPC pipeline (emitted by the main-side bridge
 * every time an assistant `message.updated` carries token data).
 *
 * On mount we perform a one-shot REST seed via `getContextUsage` so the
 * UI has a snapshot before the first live event arrives.
 *
 * Compaction is a two-phase operation:
 *   1. Local `compactionStatus` tracks the in-flight RPC phase
 *      (`idle` → `compacting` → `success`/`error`).
 *   2. A server-side `session.compaction-done` event replays through the
 *      store and resets the usage slice to the post-compaction baseline,
 *      and we bump `compactionStatus` back to `success` before idling.
 *
 * The previous 3-second poll and the orphan `onContextUsageUpdated` /
 * `onSessionCompacted` IPC subscriptions have been removed (C5 merge).
 */
export function useContextUsage(
  sessionId: string | null,
  enabled = true,
): UseContextUsageResult {
  const [isLoading, setIsLoading] = useState(false);
  const [compactionStatus, setCompactionStatus] =
    useState<CompactionStatus>('idle');
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const resolvedIdRef = useRef<string | null>(null);
  resolvedIdRef.current = resolvedId;

  const storeUsage = useConversationSelector((state) =>
    resolvedId ? state.contextUsage[resolvedId] : undefined,
  );

  const usage: ContextUsage | null = storeUsage
    ? { ...storeUsage, updatedAt: Date.now() }
    : null;

  /**
   * Resolve a raw `sessionId` to a canonical `ses_*` provider-session id.
   * Values already prefixed with `ses_` are returned as-is. Anything else
   * is run through the main-side `resolveSession` RPC.
   */
  const resolveSessionId = useCallback(async (): Promise<string | null> => {
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

  const refresh = useCallback(async () => {
    if (!enabled) return;

    const targetSessionId = await resolveSessionId();
    if (!targetSessionId) {
      setResolvedId(null);
      return;
    }

    setResolvedId(targetSessionId);
    setIsLoading(true);
    try {
      const result = await window.api.getContextUsage(targetSessionId);
      if (result) {
        // Feed the REST snapshot into the store so UI + live events share
        // the same slice.
        seedContextUsageForSession(targetSessionId, {
          sessionId: targetSessionId,
          totalTokens: result.totalTokens,
          contextLimit: result.contextLimit,
          usableLimit: result.usableLimit,
          usagePercent: result.usagePercent,
          isNearOverflow: result.isNearOverflow,
          isOverflow: result.isOverflow,
        });
      }
    } catch (err) {
      console.warn('[useContextUsage] Failed to fetch usage:', err);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, resolveSessionId]);

  const compact = useCallback(async () => {
    if (compactionStatus === 'compacting') return;

    const targetSessionId = await resolveSessionId();
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
        setTimeout(() => setCompactionStatus('idle'), COMPACTION_RESET_MS);
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
  }, [compactionStatus, resolveSessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    usage,
    isLoading,
    compactionStatus,
    compactionError,
    compact,
    refresh,
  };
}
