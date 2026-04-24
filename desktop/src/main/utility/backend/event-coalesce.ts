/**
 * event-coalesce.ts — pure coalescing primitives extracted from
 * `event-stream.ts` for testability.
 *
 * The coalescer maintains three in-flight structures per flush tick:
 *
 *   - `queue`         — events pending flush in insertion order
 *   - `coalesceIdx`   — semantic-key → queue index (whole-object replace)
 *   - `staleDeltas`   — partIds whose deltas are redundant and must be
 *                       filtered out at flush time
 *
 * Stale-delta semantics mirror opencode's global-sdk.tsx: a partId is
 * only marked stale when a NEW whole-part event REPLACES a prior one
 * already queued. A first-time whole-part (empty text) does not
 * invalidate subsequent deltas — those deltas carry the only copy of
 * the streamed characters and MUST survive the flush. See regression
 * test in `event-coalesce.test.ts`.
 */

import type { ConversationEvent } from '../../../preload/api/types';

export type CoalesceState = {
  queue: ConversationEvent[];
  coalesceIdx: Map<string, number>;
  staleDeltas: Set<string>;
};

export function createCoalesceState(): CoalesceState {
  return {
    queue: [],
    coalesceIdx: new Map(),
    staleDeltas: new Set(),
  };
}

/**
 * Compute a semantic-key for whole-object events. Events with the same
 * semantic key collapse to the latest one in the queue.
 *
 * Delta events do NOT coalesce by key — they accumulate (the renderer
 * reducer string-appends in place, matching opencode's approach).
 */
export function semanticKey(event: ConversationEvent): string | null {
  switch (event.type) {
    case 'message.updated':
      return `msg:${event.message.id}`;
    case 'message.part.updated':
      return `part:${event.part.id}`;
    case 'session.status':
      return `status:${event.sessionId}`;
    case 'message.removed':
      return `rm:${event.messageId}`;
    case 'session.compacted':
      return `compact:${event.sessionId}:${event.messageId}`;
    case 'todo.updated':
      return `todo:${event.sessionId}`;
    case 'vcs.updated':
      return `vcs:global`;
    case 'context.usage':
      return `ctx:${event.sessionId}`;
    case 'session.compaction-done':
      return `cdone:${event.sessionId}`;
    case 'file.edited':
      return `file:${event.directory ?? ''}:${event.file}`;
    case 'message.part.removed':
      return `partrm:${event.partId}`;
    case 'permission.asked':
      return `perm.ask:${event.requestId}`;
    case 'permission.replied':
      return `perm.reply:${event.requestId}`;
    case 'question.asked':
      return `q.ask:${event.requestId}`;
    case 'question.cleared':
      return `q.clear:${event.requestId}`;
    case 'session.diff':
      return `diff:${event.sessionId}`;
    case 'mcp.tools.changed':
      return `mcp.tools:${event.server}`;
    case 'mcp.browser.open.failed':
      return `mcp.browser.fail:${event.mcpName}:${event.url}`;
    case 'installation.update-available':
      return `install.upd:${event.version}`;
    case 'message.part.delta':
      return null; // deltas accumulate, they don't coalesce
    default:
      return null;
  }
}

/**
 * Mutates `state` to enqueue `event`, applying coalescing rules
 * identical to opencode's global-sdk dispatcher.
 *
 * Stale-delta bookkeeping is intentionally ONLY performed when a
 * whole-part REPLACES a prior whole-part already queued this tick
 * (i.e. an actual coalesce). See comment in event-coalesce.ts
 * module header.
 */
export function enqueueEvent(
  state: CoalesceState,
  event: ConversationEvent,
): void {
  const key = semanticKey(event);
  if (key !== null) {
    const existingIdx = state.coalesceIdx.get(key);
    if (existingIdx !== undefined && existingIdx < state.queue.length) {
      state.queue[existingIdx] = event;
      if (event.type === 'message.part.updated') {
        // The superseding whole-part carries the accumulated text, so
        // any earlier deltas for this partId are now redundant.
        state.staleDeltas.add(event.part.id);
      }
      return;
    }
    state.coalesceIdx.set(key, state.queue.length);
  }
  state.queue.push(event);
}

/**
 * Produce the final event list for a flush, filtering out deltas whose
 * part is in `staleDeltas`. Does NOT reset `state` — the caller is
 * responsible for clearing after the batch is sent.
 */
export function drainFlush(state: CoalesceState): ConversationEvent[] {
  if (state.staleDeltas.size === 0) return state.queue;
  return state.queue.filter(
    (e) => e.type !== 'message.part.delta' || !state.staleDeltas.has(e.partId),
  );
}
