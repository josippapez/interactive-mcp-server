/**
 * conversation-store.ts — renderer-side conversation state container
 *
 * Holds the split-map state (messages by sessionId, parts by messageId,
 * status by sessionId) driven by:
 *
 *   1. `ConversationBatch` IPC messages from the main-process event-stream
 *      (see `src/main/opencode/event-stream.ts`). Delivered via
 *      `window.api.events.onConversationBatch`.
 *   2. One-off REST seeds on hook mount (via `seedConversationMessages`).
 *
 * Exposes:
 *   - `conversationStore` — the live `@tanstack/store` instance.
 *   - `applyBatch(batch)` — dispatched by `useConversation`'s IPC listener.
 *   - `seedMessages(sessionId, msgs)` — one-shot seed on mount.
 *   - `useConversationSelector` — memoizing `useSyncExternalStore` hook.
 *
 * Follows the same pattern as `session-graph.ts` in this repo.
 */

import { useRef, useSyncExternalStore } from 'react';
import { Store } from '@tanstack/store';
import type {
  ConversationBatch,
  ConversationContextUsage,
  ConversationMessage,
  ConversationTodoItem,
} from '../../../preload/api/types';
import {
  applyConversationBatch,
  initialConversationState,
  seedConversationMessages,
  type ConversationSessionStatus,
  type ConversationState,
} from './conversation-reducer';
import { PERF_LOG_ENABLED } from '../lib/perf-flag';
import { clearSessionSnapshotCache } from '../hooks/useConversation.helpers';

export const conversationStore = new Store<ConversationState>(
  initialConversationState,
);

/**
 * Opt-in perf gate. Logs main→renderer hop latency per batch, to validate
 * §6 metric #2 (steady-state delta latency ≤ 33 ms p95). Enable with
 * `VITE_OPENCODE_PERF_LOG=1`. See `docs/PERF-VALIDATION.md`.
 *
 * NOTE: previously enabled whenever `import.meta.env.DEV` was truthy, which
 * spammed the devtools console at ~60 Hz during streaming.
 */
const PERF_ENABLED = PERF_LOG_ENABLED;
const MAX_RETAINED_CONVERSATION_SESSIONS = 20;

const retainedSessionOrder: string[] = [];

/**
 * Listeners notified when a session is evicted from the retained-session
 * LRU. `useConversation` subscribes here to drop the matching entry from
 * its `seededSessions` dedupe cache, so the next visit to that session
 * triggers a fresh REST refetch (otherwise the dedupe lies — it says
 * "already seeded" but the store messages have been pruned).
 */
type PruneListener = (sessionId: string) => void;
const pruneListeners = new Set<PruneListener>();

export function subscribeToConversationPrune(
  listener: PruneListener,
): () => void {
  pruneListeners.add(listener);
  return () => {
    pruneListeners.delete(listener);
  };
}

function notifyPruned(sessionId: string): void {
  for (const listener of pruneListeners) {
    try {
      listener(sessionId);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Touch a session in the retained LRU and trim to the cap. Called from
 * BOTH `seedMessages` (REST seed) AND `applyBatch` (live events) so a
 * session that is actively receiving updates never gets pruned just
 * because the user navigated away and visited 20+ other sessions.
 *
 * Returns the list of session ids that were evicted by the trim so the
 * caller can also prune those slices from the store state.
 */
function touchRetainedSession(sessionId: string): string[] {
  const existingIndex = retainedSessionOrder.indexOf(sessionId);
  if (existingIndex !== -1) retainedSessionOrder.splice(existingIndex, 1);
  retainedSessionOrder.push(sessionId);
  const evicted: string[] = [];
  while (retainedSessionOrder.length > MAX_RETAINED_CONVERSATION_SESSIONS) {
    const next = retainedSessionOrder.shift();
    if (next !== undefined) evicted.push(next);
  }
  return evicted;
}

function pruneConversationState(
  state: ConversationState,
  keepSessionIds: ReadonlySet<string>,
): ConversationState {
  let next = state;
  for (const sessionId of Object.keys(state.messages)) {
    if (keepSessionIds.has(sessionId)) continue;
    const sessionMessages = next.messages[sessionId];
    const nextMessages = { ...next.messages };
    const nextParts = { ...next.parts };
    if (sessionMessages) {
      for (const msg of sessionMessages) delete nextParts[msg.id];
    }
    delete nextMessages[sessionId];
    clearSessionSnapshotCache(sessionId);
    notifyPruned(sessionId);
    next = { ...next, messages: nextMessages, parts: nextParts };
  }
  return next;
}

/**
 * Apply a coalesced batch received from the main-process event stream.
 * Idempotent: if the batch `seq` is less than or equal to the last seen
 * seq it is dropped (renderer restart / stale queue edge case).
 */
export function applyBatch(batch: ConversationBatch): void {
  if (PERF_ENABLED) {
    const hopMs = Date.now() - batch.flushedAt;

    window.api?.log?.(
      'info',
      'perf',
      `hop seq=${batch.seq} count=${batch.events.length} hopMs=${hopMs}`,
    );
  }

  // Mark every session that appears in this batch as retained so live
  // activity keeps a session out of the prune set. Without this, a
  // session that receives only live events (and was seeded long ago)
  // gets nuked the next time some OTHER session triggers a seed-time
  // prune — making the chat appear empty when the user navigates back.
  const touchedInBatch = new Set<string>();
  for (const ev of batch.events) {
    const sessionId = (ev as { sessionId?: string }).sessionId;
    if (!sessionId || touchedInBatch.has(sessionId)) continue;
    touchedInBatch.add(sessionId);
    touchRetainedSession(sessionId);
  }

  conversationStore.setState((prev) => {
    if (batch.seq <= prev.lastSeq && prev.lastSeq !== 0) {
      // Out-of-order / duplicate batch; ignore.
      return prev;
    }
    return applyConversationBatch(prev, batch.events, batch.seq);
  });
}

/**
 * Seed the store with REST-fetched messages for a session. Called by
 * `useConversation` on first mount so users see history immediately,
 * before any live events arrive.
 */
export function seedMessages(
  sessionId: string,
  messages: readonly ConversationMessage[],
): void {
  touchRetainedSession(sessionId);
  const keepSessionIds = new Set(retainedSessionOrder);
  conversationStore.setState((prev) =>
    pruneConversationState(
      seedConversationMessages(prev, sessionId, messages),
      keepSessionIds,
    ),
  );
}

/**
 * Clear all state for a session. Used on session deletion.
 */
export function clearSession(sessionId: string): void {
  conversationStore.setState((prev) => {
    if (!prev.messages[sessionId] && !prev.status[sessionId]) return prev;
    const nextMessages = { ...prev.messages };
    const sessionMessages = nextMessages[sessionId];
    const nextParts = { ...prev.parts };
    if (sessionMessages) {
      for (const msg of sessionMessages) delete nextParts[msg.id];
    }
    delete nextMessages[sessionId];
    clearSessionSnapshotCache(sessionId);
    const nextStatus = { ...prev.status };
    delete nextStatus[sessionId];
    const nextTodos = { ...prev.todos };
    delete nextTodos[sessionId];
    const nextContextUsage = { ...prev.contextUsage };
    delete nextContextUsage[sessionId];
    const nextReviewDiffs = { ...prev.reviewDiffs };
    delete nextReviewDiffs[sessionId];
    const nextSessionSideChannels = { ...prev.sessionSideChannels };
    delete nextSessionSideChannels[sessionId];
    const nextErrors = { ...prev.errors };
    delete nextErrors[sessionId];
    const nextRetries = { ...prev.retries };
    delete nextRetries[sessionId];
    const retainedIndex = retainedSessionOrder.indexOf(sessionId);
    if (retainedIndex !== -1) retainedSessionOrder.splice(retainedIndex, 1);
    return {
      ...prev,
      messages: nextMessages,
      parts: nextParts,
      status: nextStatus,
      todos: nextTodos,
      contextUsage: nextContextUsage,
      reviewDiffs: nextReviewDiffs,
      sessionSideChannels: nextSessionSideChannels,
      errors: nextErrors,
      retries: nextRetries,
    };
  });
}

/**
 * Dismiss the provider-error banner for a session. The error stays in
 * the store until the user dismisses it or the session resumes streaming.
 */
export function dismissSessionError(sessionId: string): void {
  conversationStore.setState((prev) => {
    if (!(sessionId in prev.errors)) return prev;
    const nextErrors = { ...prev.errors };
    delete nextErrors[sessionId];
    return { ...prev, errors: nextErrors };
  });
}

// ─── Seed dispatchers (C5) ───────────────────────────────────────────────────

/**
 * Seed todos for a session from a REST fetch. Hooks call this once on
 * mount so the UI shows the latest todo list before any `todo.updated`
 * event arrives.
 */
export function seedTodosForSession(
  sessionId: string,
  todos: readonly ConversationTodoItem[],
): void {
  conversationStore.setState((prev) => ({
    ...prev,
    todos: { ...prev.todos, [sessionId]: [...todos] },
  }));
}

/**
 * Seed the global VCS branch from a REST fetch. There is only one VCS
 * branch tracked globally today — it reflects the project the user is
 * working in, not a per-session value.
 */
export function seedVcsBranch(branch: string | null): void {
  conversationStore.setState((prev) => {
    if (prev.vcsBranch === branch) return prev;
    return { ...prev, vcsBranch: branch };
  });
}

/**
 * Seed context usage for a session from the REST `getContextUsage` RPC.
 * Live updates arrive via the `context.usage` ConversationEvent once the
 * main-process bridge has observed a `message.updated` for the session.
 */
export function seedContextUsageForSession(
  sessionId: string,
  usage: ConversationContextUsage,
): void {
  conversationStore.setState((prev) => ({
    ...prev,
    contextUsage: {
      ...prev.contextUsage,
      [sessionId]: { ...usage, sessionId },
    },
  }));
}

/**
 * Seed coarse session status for a set of sessions from a REST
 * `fetchSessionStatus` payload. The shape mirrors the REST endpoint
 * (keyed by sessionId with a `type` field) so hooks can pass the
 * payload through directly.
 */
export function seedSessionStatus(
  sessionId: string,
  status: ConversationSessionStatus,
): void {
  conversationStore.setState((prev) => {
    if (prev.status[sessionId] === status) return prev;
    return { ...prev, status: { ...prev.status, [sessionId]: status } };
  });
}

export function replaceSessionStatusSnapshot(
  statuses: Record<string, ConversationSessionStatus>,
): void {
  conversationStore.setState((prev) => {
    const prevKeys = Object.keys(prev.status);
    const nextKeys = Object.keys(statuses);
    if (
      prevKeys.length === nextKeys.length &&
      nextKeys.every((key) => prev.status[key] === statuses[key])
    ) {
      return prev;
    }
    return { ...prev, status: { ...statuses } };
  });
}

const subscribeConversationStore = (listener: () => void): (() => void) =>
  conversationStore.subscribe(listener);

/**
 * Memoizing `useSyncExternalStore` wrapper. Pattern borrowed from
 * `session-graph.ts`: cache the last selector result and return it
 * unchanged when the equality comparator says we're still current,
 * so consumer components don't re-render needlessly.
 */
export function useConversationSelector<T>(
  selector: (state: ConversationState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<T | undefined>(undefined);

  return useSyncExternalStore(
    subscribeConversationStore,
    () => {
      const next = selector(conversationStore.state);
      const previous = cacheRef.current;
      if (previous !== undefined && isEqual(previous, next)) {
        return previous;
      }
      cacheRef.current = next;
      return next;
    },
    () => selector(conversationStore.state),
  );
}

export function _resetConversationStoreForTest(): void {
  retainedSessionOrder.splice(0, retainedSessionOrder.length);
  conversationStore.setState(initialConversationState);
}
