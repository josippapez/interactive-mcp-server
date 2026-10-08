/**
 * useConversation — live conversation state for a given session.
 *
 * Wiring:
 *   - On mount, performs a REST seed via `window.api.sessions.fetchConversationMessages`
 *     to populate historical messages/parts for the session. The seed
 *     runs once per (sessionId, connectionId) pair.
 *   - Subscribes to the main-process event stream via
 *     `window.api.events.onConversationBatch` and dispatches each batch
 *     to the global `conversationStore` (see `store/conversation-store.ts`).
 *   - Returns a selector-backed view containing `{messages, parts, status}`
 *     for the active session, memoized so identity is stable across
 *     unrelated batch dispatches.
 *
 * Design notes:
 *   - The IPC listener is attached once per mount (StrictMode-safe via
 *     effect cleanup). All hook instances share the same store, so
 *     multiple `useConversation` calls do not create duplicate listeners
 *     — we use a module-level ref count.
 *   - `status` defaults to `'idle'` when the session has no recorded
 *     status yet.
 *   - Messages + parts are joined into a single `messages` array with
 *     inlined `parts` at selector time — this is the shape
 *     `ChatHistoryView`/`mergeMessages` already expects. Join cost is
 *     O(messages + totalParts) per render, offset by stable refs when
 *     nothing changed for that session.
 */

import { useEffect, useRef, useState } from 'react';
import type { ConversationMessage } from '../../../preload/api/types';
import {
  applyBatch,
  conversationStore,
  seedMessages,
  subscribeToConversationPrune,
  useConversationSelector,
} from '../store/conversation-store';
import type { ConversationSessionStatus } from '../store/conversation-reducer';
import {
  NULL_SNAPSHOT,
  clearSnapshotCache,
  selectSession,
  snapshotsEqual,
} from './useConversation.helpers';

// ─── Singleton IPC subscription ──────────────────────────────────────────────

/**
 * We want exactly one `onConversationBatch` listener for the whole
 * renderer process, regardless of how many components call
 * `useConversation`. Ref-count mounts so we attach/detach at the
 * boundaries only.
 */
let ipcRefCount = 0;
let ipcUnsubscribe: (() => void) | null = null;

function retainIpcListener(): void {
  ipcRefCount += 1;
  if (ipcRefCount !== 1) return;
  const api = window.api;
  if (!api?.onConversationBatch) return;
  ipcUnsubscribe = api.onConversationBatch((batch) => {
    applyBatch(batch);
    // After applying the batch, check if any `session.compacted` event
    // was in it. The reducer clears the message slice for that session
    // (OpenCode rewrites history in place during compaction), so we
    // must evict it from the seed dedupe cache and refetch fresh
    // messages from the server. Without this, the channel appears
    // empty because live `message.updated` replays alone do not
    // restore preserved pre-compaction messages.
    for (const ev of batch.events) {
      if (ev.type === 'session.compacted') {
        seededSessions.delete(ev.sessionId);
        void seedOnce(ev.sessionId);
      }
    }
  });
}

function releaseIpcListener(): void {
  ipcRefCount -= 1;
  if (ipcRefCount > 0) return;
  ipcUnsubscribe?.();
  ipcUnsubscribe = null;
}

// ─── REST seed deduplication ─────────────────────────────────────────────────

/**
 * Track which sessions have been seeded to avoid redundant REST fetches
 * on remount or hook re-run. The server is the source of truth; once
 * seeded, live events keep the store current.
 */
const seededSessions = new Set<string>();
const MAX_SEEDED_SESSIONS = 20;
export const CONVERSATION_REST_SEED_LIMIT = 500;
const seededSessionOrder: string[] = [];

export function shouldCacheConversationSeedResult(
  messages: readonly ConversationMessage[],
): boolean {
  return messages.length > 0;
}

function markSeeded(sessionId: string): void {
  const existingIndex = seededSessionOrder.indexOf(sessionId);
  if (existingIndex !== -1) seededSessionOrder.splice(existingIndex, 1);
  seededSessionOrder.push(sessionId);
  seededSessions.add(sessionId);
  while (seededSessionOrder.length > MAX_SEEDED_SESSIONS) {
    const evicted = seededSessionOrder.shift();
    if (evicted) seededSessions.delete(evicted);
  }
}

/**
 * Drop a session from the seed dedupe cache. Wired to the store's prune
 * notifications so that when the conversation store evicts a session's
 * messages (LRU pressure), the next mount for that session will re-seed
 * from REST instead of believing "already seeded" and rendering empty.
 */
function invalidateSeeded(sessionId: string): void {
  if (!seededSessions.has(sessionId)) return;
  seededSessions.delete(sessionId);
  const index = seededSessionOrder.indexOf(sessionId);
  if (index !== -1) seededSessionOrder.splice(index, 1);
}

// Module-level subscription — single global listener for the lifetime of
// the renderer process. Unsubscribe is unnecessary (module never unloads
// in production) but kept for symmetry / future hot-reload safety.
subscribeToConversationPrune(invalidateSeeded);

async function seedOnce(sessionId: string): Promise<void> {
  if (seededSessions.has(sessionId)) return;

  seededSessions.add(sessionId);
  try {
    const api = window.api;
    if (!api?.fetchConversationMessages) return;
    const messages = await api.fetchConversationMessages(sessionId, {
      limit: CONVERSATION_REST_SEED_LIMIT,
    });
    if (messages.length > 0) seedMessages(sessionId, messages);
    if (shouldCacheConversationSeedResult(messages)) {
      markSeeded(sessionId);
    } else {
      seededSessions.delete(sessionId);
    }
  } catch {
    // Best-effort seed — if it fails the live stream will still fill in
    // whatever the user is actively doing.
    seededSessions.delete(sessionId); // allow retry on next mount
  }
}

// ─── Selector (join messages + parts) ────────────────────────────────────────

const EMPTY_MESSAGES: ConversationMessage[] = [];

// ─── Hook ────────────────────────────────────────────────────────────────────

export type UseConversationResult = {
  messages: ConversationMessage[];
  status: ConversationSessionStatus;
  isStreaming: boolean;
  isSeeding: boolean;
};

const EMPTY_RESULT: UseConversationResult = {
  messages: EMPTY_MESSAGES,
  status: 'idle',
  isStreaming: false,
  isSeeding: false,
};

/**
 * Subscribe to live conversation state for a single session.
 *
 * Pass `null` / `undefined` when no session is active — the hook becomes
 * a no-op and returns `EMPTY_RESULT`. This lets callers conditionally
 * render the chat view without an `if` around the hook call.
 */
export function useConversation(
  sessionId: string | null | undefined,
): UseConversationResult {
  const retainedRef = useRef(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(() => {
    if (!sessionId) return false;
    // Don't show seeding state if the store already has data OR we've
    // already seeded this session previously (avoids a flash of skeleton
    // when switching back to a session mid-session).
    if (seededSessions.has(sessionId)) return false;
    const existing = conversationStore.state.messages[sessionId];
    return !(existing && existing.length > 0);
  });

  useEffect(() => {
    if (!sessionId) {
      setIsSeeding(false);
      return;
    }

    retainIpcListener();
    retainedRef.current = true;

    // Only flip to seeding if we truly need to fetch. Otherwise skip
    // straight to ready so the consumer doesn't render a skeleton over
    // existing data.
    const existing = conversationStore.state.messages[sessionId];
    const needsFetch =
      !seededSessions.has(sessionId) && !(existing && existing.length > 0);
    setIsSeeding(needsFetch);

    void seedOnce(sessionId).finally(() => {
      setIsSeeding(false);
    });

    return () => {
      if (!retainedRef.current) return;
      retainedRef.current = false;
      releaseIpcListener();
    };
  }, [sessionId]);

  const snapshot = useConversationSelector(
    (state) => (sessionId ? selectSession(state, sessionId) : NULL_SNAPSHOT),
    snapshotsEqual,
  );

  if (!sessionId) return EMPTY_RESULT;

  return {
    messages: snapshot.messages,
    status: snapshot.status,
    isStreaming: snapshot.status === 'streaming',
    isSeeding: isSeeding && snapshot.messages.length === 0,
  };
}

/**
 * Force-reset the seed cache, e.g., on logout or connection change so
 * the next `useConversation(id)` refetches from REST.
 */
export function resetConversationSeedCache(): void {
  seededSessions.clear();
  seededSessionOrder.splice(0, seededSessionOrder.length);
  conversationStore.setState((prev) => {
    // Preserve lastSeq (don't re-replay duplicates from main) but drop
    // cached messages/parts/status and auxiliary slices.
    if (
      Object.keys(prev.messages).length === 0 &&
      Object.keys(prev.parts).length === 0 &&
      Object.keys(prev.status).length === 0 &&
      Object.keys(prev.todos).length === 0 &&
      Object.keys(prev.contextUsage).length === 0 &&
      Object.keys(prev.reviewDiffs).length === 0 &&
      prev.vcsBranch === null &&
      prev.lastFileEdit === null
    ) {
      return prev;
    }
    return {
      messages: {},
      parts: {},
      status: {},
      todos: {},
      contextUsage: {},
      reviewDiffs: {},
      sessionSideChannels: {},
      vcsBranch: null,
      lastFileEdit: null,
      lastSeq: prev.lastSeq,
    };
  });
  clearSnapshotCache();
}
