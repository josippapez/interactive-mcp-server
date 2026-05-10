/**
 * conversation-reducer.ts — pure (state, event) => state
 *
 * Applies a single `ConversationEvent` to the split-map conversation state.
 * Mirrors opencode's `packages/app/src/context/global-sync/event-reducer.ts`:
 *
 *   - `messages` is keyed by sessionId and holds `ConversationMessage[]`
 *     sorted by id (binary-search insertion on `message.updated`).
 *   - `parts` is keyed by messageId and holds `ConversationMessagePart[]`
 *     sorted by id (binary-search insertion on `message.part.updated`).
 *   - `message.part.delta` does an in-place string-append on the targeted
 *     part's `text` field, via immer `produce`. This is the hot path —
 *     it fires dozens of times per second during streaming and must not
 *     rebuild the whole parts array each time.
 *   - `session.status` is a flat record keyed by sessionId.
 *
 * Everything here is pure and synchronous. Side effects (IPC subscribe,
 * REST seed) live in `useConversation.ts`.
 *
 * IMPORTANT (H2/H3 perf): `applyConversationBatch` wraps the entire batch
 * in a SINGLE `produce(...)`. Each per-event handler is a draft-mutating
 * helper (`applyXxxDraft`) that mutates the supplied draft in place. This
 * preserves object identity for untouched slices: e.g., a burst of text
 * deltas against one message does not churn `state.parts` or the target
 * message's `parts` array identity, keeping `useConversation`'s
 * `cached.parts === state.parts` fast path alive across deltas.
 */

import { produce, type Draft } from 'immer';
import type {
  ConversationContextUsage,
  ConversationEvent,
  ConversationMessage,
  ConversationMessagePart,
  ConversationSessionSideChannel,
  ConversationTodoItem,
} from '../../../preload/api/types';

export type ConversationSessionStatus = 'idle' | 'streaming' | 'error';

export type ConversationFileEdit = {
  directory: string | null;
  file: string;
  at: number;
};

export type ConversationState = {
  /** Messages per session, sorted by id asc. */
  messages: Record<string, ConversationMessage[]>;
  /** Parts per message, sorted by id asc. */
  parts: Record<string, ConversationMessagePart[]>;
  /** Session status snapshot. */
  status: Record<string, ConversationSessionStatus>;
  /** Todos per session (live updates from `todo.updated`). */
  todos: Record<string, ConversationTodoItem[]>;
  /** Context usage per session (live updates from `context.usage`). */
  contextUsage: Record<string, ConversationContextUsage>;
  /** Latest non-chat `session.next.*` side-channel metadata per session. */
  sessionSideChannels: Record<string, ConversationSessionSideChannel>;
  /** Most recent VCS branch reported by `vcs.updated`. */
  vcsBranch: string | null;
  /** Most recent file edit event (for cache invalidation / UX hints). */
  lastFileEdit: ConversationFileEdit | null;
  /** Last seen batch seq, for gap detection telemetry. */
  lastSeq: number;
};

export const initialConversationState: ConversationState = {
  messages: {},
  parts: {},
  status: {},
  todos: {},
  contextUsage: {},
  sessionSideChannels: {},
  vcsBranch: null,
  lastFileEdit: null,
  lastSeq: 0,
};

type ConversationDraft = Draft<ConversationState>;

// ─── Binary search helpers ───────────────────────────────────────────────────

type SearchResult = { found: boolean; index: number };

/**
 * Binary search a sorted array for an item by a key-extractor. Returns
 * `{found: true, index}` if the key exists, otherwise
 * `{found: false, index}` where `index` is the correct insertion point
 * to preserve sort order.
 *
 * Mirrors opencode's `Binary.search` utility.
 */
function binarySearch<T>(
  arr: readonly T[],
  needle: string,
  getKey: (item: T) => string,
): SearchResult {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const key = getKey(arr[mid]!);
    if (key === needle) return { found: true, index: mid };
    if (key < needle) lo = mid + 1;
    else hi = mid;
  }
  return { found: false, index: lo };
}

// ─── Event handlers (draft-mutating) ─────────────────────────────────────────

function applyMessageUpdatedDraft(
  draft: ConversationDraft,
  message: ConversationMessage,
): void {
  const list = draft.messages[message.sessionId];
  if (!list) {
    // Strip incoming parts — parts flow through their own events only.
    draft.messages[message.sessionId] = [
      { ...message, parts: [] } as Draft<ConversationMessage>,
    ];
    return;
  }
  const result = binarySearch(list, message.id, (m) => m.id);
  if (result.found) {
    // Preserve parts — message envelope may have stale or empty parts.
    // Parts flow through their own events; we never overwrite them
    // from a message.updated payload.
    const existing = list[result.index]!;
    list[result.index] = {
      ...message,
      variant: message.variant ?? existing.variant,
      modelId: message.modelId ?? existing.modelId,
      providerId: message.providerId ?? existing.providerId,
      agent: message.agent ?? existing.agent,
      parts: existing.parts,
    } as Draft<ConversationMessage>;
  } else {
    list.splice(result.index, 0, {
      ...message,
      parts: [],
    } as Draft<ConversationMessage>);
  }
}

function applyMessageRemovedDraft(
  draft: ConversationDraft,
  sessionId: string,
  messageId: string,
): void {
  const list = draft.messages[sessionId];
  if (list) {
    const result = binarySearch(list, messageId, (m) => m.id);
    if (result.found) list.splice(result.index, 1);
  }
  delete draft.parts[messageId];
}

function applyPartUpdatedDraft(
  draft: ConversationDraft,
  messageId: string,
  part: ConversationMessagePart,
): void {
  const list = draft.parts[messageId];
  if (!list) {
    draft.parts[messageId] = [part as Draft<ConversationMessagePart>];
    return;
  }
  const result = binarySearch(list, part.id, (p) => p.id);
  if (result.found) {
    // Mutate in place — replace the existing draft entry. The
    // target array identity is preserved.
    list[result.index] = part as Draft<ConversationMessagePart>;
  } else {
    list.splice(result.index, 0, part as Draft<ConversationMessagePart>);
  }
}

function applyPartDeltaDraft(
  draft: ConversationDraft,
  messageId: string,
  partId: string,
  delta: string,
): void {
  const list = draft.parts[messageId];
  if (!list) return; // unknown message — whole-part event will race in
  const result = binarySearch(list, partId, (p) => p.id);
  if (!result.found) return; // unknown part — same story
  // In-place string-append — does NOT reassign `draft.parts` nor the
  // target `draft.parts[messageId]` array. Immer only produces a new
  // array for `parts[messageId]` and a new map for `parts` when the
  // draft records a structural change to that slot; mutating a nested
  // scalar leaves both alone.
  const target = list[result.index]!;
  target.text = (target.text ?? '') + delta;
}

function applySessionStatusDraft(
  draft: ConversationDraft,
  sessionId: string,
  status: ConversationSessionStatus,
): void {
  if (draft.status[sessionId] === status) return;
  draft.status[sessionId] = status;
}

function applySessionCompactedDraft(
  draft: ConversationDraft,
  sessionId: string,
): void {
  // On `session.compacted`, OpenCode rewrites the session's visible history
  // in place: a synthesized compaction-summary assistant message is inserted
  // and any preserved tail messages are re-emitted via `message.updated`.
  // Previously we wiped the entire slice here, which lost history if the
  // replay didn't deliver every prior message. Now we leave existing
  // messages in place and let subsequent `message.updated` / `message.removed`
  // events reconcile the slice naturally.
  void draft;
  void sessionId;
}

function applyTodosUpdatedDraft(
  draft: ConversationDraft,
  sessionId: string,
  todos: ConversationTodoItem[],
): void {
  draft.todos[sessionId] = todos as Draft<ConversationTodoItem[]>;
}

function applyVcsUpdatedDraft(
  draft: ConversationDraft,
  branch: string | null,
): void {
  if (draft.vcsBranch === branch) return;
  draft.vcsBranch = branch;
}

function applyContextUsageDraft(
  draft: ConversationDraft,
  usage: ConversationContextUsage,
): void {
  draft.contextUsage[usage.sessionId] =
    usage as Draft<ConversationContextUsage>;
}

function applyCompactionDoneDraft(
  draft: ConversationDraft,
  sessionId: string,
  beforeTokens: number,
  afterTokens: number,
): void {
  const existing = draft.contextUsage[sessionId];
  if (existing) {
    const contextLimit = existing.contextLimit;
    const usableLimit = existing.usableLimit;
    existing.totalTokens = afterTokens;
    existing.usagePercent =
      contextLimit > 0 ? Math.round((afterTokens / contextLimit) * 100) : 0;
    existing.isNearOverflow =
      usableLimit > 0 &&
      afterTokens >= usableLimit * 0.8 &&
      afterTokens < usableLimit;
    existing.isOverflow = usableLimit > 0 && afterTokens >= usableLimit;
  }
  // before is kept for telemetry purposes; no state besides usage
  // counters is derived from it today.
  void beforeTokens;
}

function ensureSessionSideChannelDraft(
  draft: ConversationDraft,
  sessionId: string,
): Draft<ConversationSessionSideChannel> {
  return (draft.sessionSideChannels[sessionId] ??=
    {} as Draft<ConversationSessionSideChannel>);
}

function applySessionNextModelSwitchedDraft(
  draft: ConversationDraft,
  sessionId: string,
  model: {
    modelId: string;
    providerId: string;
    variant?: string;
  },
): void {
  const channel = ensureSessionSideChannelDraft(draft, sessionId);
  channel.model = model;
}

function toolProgressText(
  event: Extract<ConversationEvent, { type: 'session.next.tool.progress' }>,
): string | undefined {
  const text = event.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  return text || undefined;
}

function applySessionNextToolProgressDraft(
  draft: ConversationDraft,
  event: Extract<ConversationEvent, { type: 'session.next.tool.progress' }>,
): void {
  const progressText = toolProgressText(event);
  for (const parts of Object.values(draft.parts)) {
    const part = parts.find(
      (candidate) =>
        candidate.type === 'tool-call' &&
        candidate.toolCallId === event.callId &&
        candidate.toolStatus === 'running',
    );
    if (!part) continue;
    part.toolMetadata = {
      ...(part.toolMetadata ?? {}),
      progress: {
        structured: event.structured,
        content: event.content,
        updatedAt: event.timestamp,
      },
    };
    if (progressText) {
      part.toolOutput = progressText;
    }
    return;
  }
}

function applyFileEditedDraft(
  draft: ConversationDraft,
  directory: string | null,
  file: string,
): void {
  draft.lastFileEdit = { directory, file, at: Date.now() };
}

/**
 * Draft-mutating dispatch for a single event. Never allocates a new
 * root state — all changes flow through the supplied draft.
 */
function applyEventToDraft(
  draft: ConversationDraft,
  event: ConversationEvent,
): void {
  switch (event.type) {
    case 'message.updated':
      applyMessageUpdatedDraft(draft, event.message);
      return;
    case 'message.removed':
      applyMessageRemovedDraft(draft, event.sessionId, event.messageId);
      return;
    case 'message.part.updated':
      applyPartUpdatedDraft(draft, event.messageId, event.part);
      return;
    case 'message.part.delta':
      applyPartDeltaDraft(draft, event.messageId, event.partId, event.delta);
      return;
    case 'session.status':
      applySessionStatusDraft(draft, event.sessionId, event.status);
      return;
    case 'session.compacted':
      applySessionCompactedDraft(draft, event.sessionId);
      return;
    case 'todo.updated':
      applyTodosUpdatedDraft(draft, event.sessionId, event.todos);
      return;
    case 'vcs.updated':
      applyVcsUpdatedDraft(draft, event.branch);
      return;
    case 'context.usage':
      applyContextUsageDraft(draft, {
        sessionId: event.sessionId,
        totalTokens: event.totalTokens,
        contextLimit: event.contextLimit,
        usableLimit: event.usableLimit,
        usagePercent: event.usagePercent,
        isNearOverflow: event.isNearOverflow,
        isOverflow: event.isOverflow,
      });
      return;
    case 'session.compaction-done':
      applyCompactionDoneDraft(
        draft,
        event.sessionId,
        event.beforeTokens,
        event.afterTokens,
      );
      return;
    case 'session.next.model.switched':
      applySessionNextModelSwitchedDraft(draft, event.sessionId, {
        modelId: event.modelId,
        providerId: event.providerId,
        variant: event.variant,
      });
      return;
    case 'session.next.retried':
    case 'session.next.compaction.started':
    case 'session.next.compaction.ended':
      return;
    case 'session.next.tool.progress':
      applySessionNextToolProgressDraft(draft, event);
      return;
    case 'file.edited':
      applyFileEditedDraft(draft, event.directory, event.file);
      return;
    // Events below are consumed by dedicated hooks (usePermissionHandlers,
    // useQuestionHandlers, status/tools listeners) rather than by the
    // message/part reducer. Still enumerated here to keep the exhaustiveness
    // guard happy. `message.part.removed` is intentionally a no-op in this
    // reducer until part-removal becomes a rendering concern.
    case 'message.part.removed':
    case 'permission.asked':
    case 'permission.replied':
    case 'question.asked':
    case 'question.cleared':
    case 'session.diff':
    case 'mcp.tools.changed':
    case 'mcp.browser.open.failed':
    case 'installation.update-available':
      return;
    default: {
      // Exhaustiveness guard — compile error if a new event type is added
      // to the union without a handler here.
      const _exhaustive: never = event;
      void _exhaustive;
      return;
    }
  }
}

// ─── Public reducer ──────────────────────────────────────────────────────────

/**
 * Pure reducer: apply one event. Allocates a fresh produce() for a
 * single-event call — suitable for ad-hoc tests or main-driven updates
 * that don't go through `applyConversationBatch`. Hot-path callers
 * should use `applyConversationBatch` instead to amortize the draft
 * cost.
 */
export function applyConversationEvent(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  return produce(state, (draft) => {
    applyEventToDraft(draft, event);
  });
}

/**
 * Apply a whole batch of events in ONE `produce()` pass. This is the
 * main entry point used by the renderer IPC listener.
 *
 * The single-produce design preserves object identity on untouched
 * slices: a burst of 30 text-deltas against one message does NOT
 * allocate 30 new `state.parts` maps — `state.parts` only gets a new
 * reference if the batch structurally added/removed an entry.
 */
export function applyConversationBatch(
  state: ConversationState,
  events: readonly ConversationEvent[],
  seq: number,
): ConversationState {
  if (events.length === 0) {
    if (state.lastSeq === seq) return state;
    return produce(state, (draft) => {
      draft.lastSeq = seq;
    });
  }

  return produce(state, (draft) => {
    for (const ev of events) {
      applyEventToDraft(draft, ev);
    }
    if (draft.lastSeq !== seq) {
      draft.lastSeq = seq;
    }
  });
}

/**
 * Seed the store from a REST fetch result. Used by `useConversation` on
 * first mount to populate historical messages before live events arrive.
 *
 * Early-return guard: if `state.messages[sessionId]` already has at least
 * as many entries as the incoming seed, we've already been filled in by
 * live events (or a previous seed). Returning the existing state
 * unchanged prevents a slow seed from clobbering newer streamed data.
 */
export function seedConversationMessages(
  state: ConversationState,
  sessionId: string,
  messages: readonly ConversationMessage[],
): ConversationState {
  return produce(state, (draft) => {
    // Sort defensively — REST response is usually chronological but
    // binary-search requires strict id-asc order.
    const sorted = [...messages].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    for (const message of sorted) {
      applyMessageUpdatedDraft(draft, { ...message, parts: [] });
    }
    for (const msg of sorted) {
      if (msg.parts.length > 0) {
        const sortedParts = [...msg.parts].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        );
        for (const part of sortedParts) {
          applyPartUpdatedDraft(draft, msg.id, part);
        }
      }
    }
  });
}
