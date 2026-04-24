import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  seedSessionStatus,
  useConversationSelector,
} from '../store/conversation-store';
import type { ConversationSessionStatus } from '../store/conversation-reducer';

export type SessionStatusType = 'busy' | 'idle' | 'error' | 'unknown';

export type SessionStatusMap = Record<string, { type: SessionStatusType }>;

type UseSessionStatusResult = {
  statusMap: SessionStatusMap;
  isLoading: boolean;
  refresh: () => Promise<void>;
  getStatus: (sessionId: string) => SessionStatusType | null;
};

/**
 * Map a coarse store-side session status (`idle | streaming | error`) to the
 * 4-value external surface this hook has always exposed. `streaming` → `busy`
 * is the only non-trivial mapping.
 */
function mapStoreStatus(
  status: ConversationSessionStatus | undefined,
): SessionStatusType {
  if (status === 'streaming') return 'busy';
  if (status === 'idle') return 'idle';
  if (status === 'error') return 'error';
  return 'unknown';
}

/**
 * Map the REST `fetchSessionStatus` payload shape (`busy|idle|error|unknown`)
 * to our store-side coarse status (`streaming|idle|error`). `busy` becomes
 * `streaming`; `unknown` is seeded as `idle` (the store doesn't carry an
 * unknown bucket — it treats missing entries as idle already).
 */
function mapRestStatus(raw: string): ConversationSessionStatus {
  if (raw === 'busy') return 'streaming';
  if (raw === 'error') return 'error';
  return 'idle';
}

/**
 * Shallow-compare two status maps (same keys, same values).
 */
function statusMapsEqual(
  prev: SessionStatusMap,
  next: SessionStatusMap,
): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    const p = prev[key];
    const n = next[key];
    if (!p || p.type !== n.type) return false;
  }
  return true;
}

/**
 * Hook exposing per-session status derived from the global conversation
 * store. Status updates arrive live via `session.status` events on the
 * `conversation-batch` pipeline (mapped by the event bridge). On mount
 * we perform a one-shot REST seed via `fetchSessionStatus` so the UI has
 * a snapshot before the first live event arrives.
 *
 * Identity stability (H5 perf): the returned `statusMap` object keeps
 * its reference across renders whenever the derived key/value set is
 * unchanged, and `getStatus` is stable across renders for the whole
 * hook lifetime (reads through a ref). Callers depending on either of
 * these identities via `useMemo`/`useCallback` stay memoized across
 * unrelated `rawStatus` churn.
 */
export function useSessionStatus(
  enabled: boolean = true,
): UseSessionStatusResult {
  const rawStatus = useConversationSelector(
    (state) => state.status,
    (a, b) => a === b,
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    try {
      const result = await window.api.fetchSessionStatus?.();
      if (!result) return;
      for (const [sessionId, entry] of Object.entries(result)) {
        seedSessionStatus(sessionId, mapRestStatus(entry.type));
      }
    } catch {
      // Best-effort seed — live events will fill in eventually.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  // Memoize the exposed statusMap so its identity is preserved across
  // no-op updates (e.g., status events for sessions the caller doesn't
  // track). useMemo's equality check fires on every rawStatus change,
  // but we compare shallowly and return the previous object when the
  // shape is unchanged.
  const statusMapRef = useRef<SessionStatusMap>({});
  const statusMap = useMemo<SessionStatusMap>(() => {
    const next: SessionStatusMap = {};
    for (const key of Object.keys(rawStatus)) {
      next[key] = { type: mapStoreStatus(rawStatus[key]) };
    }
    const prev = statusMapRef.current;
    if (statusMapsEqual(prev, next)) return prev;
    statusMapRef.current = next;
    return next;
  }, [rawStatus]);

  // Stable getStatus: reads from the ref rather than capturing rawStatus
  // in the closure, so its identity never changes after mount.
  const getStatus = useCallback(
    (sessionId: string): SessionStatusType | null => {
      const map = statusMapRef.current;
      const entry = map[sessionId];
      return entry ? entry.type : null;
    },
    [],
  );

  return {
    statusMap,
    isLoading: false,
    refresh,
    getStatus,
  };
}
