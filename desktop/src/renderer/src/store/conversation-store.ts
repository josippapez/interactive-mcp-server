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

/**
 * Apply a coalesced batch received from the main-process event stream.
 * Idempotent: if the batch `seq` is less than or equal to the last seen
 * seq it is dropped (renderer restart / stale queue edge case).
 */
export function applyBatch(batch: ConversationBatch): void {
  if (PERF_ENABLED) {
    const hopMs = Date.now() - batch.flushedAt;

    console.log(
      `[perf.hop] seq=${batch.seq} count=${batch.events.length} hopMs=${hopMs}`,
    );
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
  conversationStore.setState((prev) =>
    seedConversationMessages(prev, sessionId, messages),
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
    const nextStatus = { ...prev.status };
    delete nextStatus[sessionId];
    const nextTodos = { ...prev.todos };
    delete nextTodos[sessionId];
    const nextContextUsage = { ...prev.contextUsage };
    delete nextContextUsage[sessionId];
    return {
      ...prev,
      messages: nextMessages,
      parts: nextParts,
      status: nextStatus,
      todos: nextTodos,
      contextUsage: nextContextUsage,
    };
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
    (listener) => conversationStore.subscribe(listener),
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
