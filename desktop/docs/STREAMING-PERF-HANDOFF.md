# Streaming Perf Handoff — rAF Queue + Per-Message External Stores

**Status:** handoff, no code changed. Ready to implement.
**Target repo:** `desktop/` (this repo).
**Reference repo (read-only upstream):** `/Users/josippapez/Desktop/opencode` (Solid.js web app).
**User directive:** full API change, max perf. Overrides the pre-existing "not worth it" TODO in `usePromptConnectionData.ts:45-49` and `usePromptDataState.ts:36-37`.

---

## Goal

Match the reference OpenCode web app's "feels-instant" streaming behavior in the desktop Electron app by:

1. Adopting a **rAF-batched SSE event queue** with coalescing + stale-delta suppression.
2. Moving from a single `useState<StoreState>` in `useConversation` to **per-message external stores** so a token delta re-renders **only** the affected `MessageItem` (via `useSyncExternalStore`).

Either change alone is insufficient:

- Queue alone → still top-level re-renders per flush.
- Per-message stores alone → still one React commit per token (SSE flood).

---

## Reference architecture (Solid) — what makes it fast

Files in `/Users/josippapez/Desktop/opencode/packages/app/src/context/`:

| File                                    | Mechanism                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global-sdk.tsx`                        | **16 ms flush** timeout + **8 ms stream yield**. `coalesced: Map` dedups `message.part.updated` by `${dir}:${msgID}:${partID}`. `staleDeltas: Set<partID>` populated when a full part-update queues; any `part.delta` for the same partID already queued in that frame is **dropped at flush**. All emits inside `batch(() => …)`. Heartbeat 15 s, reconnect 250 ms, visibility-change reconnect. |
| `global-sync.tsx`                       | Per-directory Solid store orchestration.                                                                                                                                                                                                                                                                                                                                                          |
| `global-sync/event-reducer.ts` L260-277 | Delta path: `produce(draft => { (part[field] as string) = (existing ?? '') + delta })`. No Map/array reallocation per token — Solid's proxy tracks the exact field. `SKIP_PARTS = { patch, step-start, step-finish }`.                                                                                                                                                                            |
| `global-sync/child-store.ts`            | Per-dir LRU (max 30, idle TTL).                                                                                                                                                                                                                                                                                                                                                                   |
| `sync.tsx`                              | Per-session sync, optimistic add/remove, prefetch, pagination.                                                                                                                                                                                                                                                                                                                                    |

Key invariant: **full snapshots never race with deltas** because staleDeltas drops stale deltas at flush time. The reducer trusts flush-layer ordering.

---

## Desktop gaps (comparison table)

| #   | Reference (Solid)                                                                  | Desktop (React) — current                                                                                                                                                                         | Target file(s)                                                                                                    |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | 16 ms rAF-style flush batches events                                               | Every SSE event fires its own `setState` → React re-renders per token                                                                                                                             | NEW `useConversation-stream-queue.ts`                                                                             |
| 2   | `coalesced` Map dedups `part.updated` per `dir:msg:part`                           | No coalescing                                                                                                                                                                                     | NEW `useConversation-stream-queue.ts`                                                                             |
| 3   | `staleDeltas` Set drops stale `part.delta` queued with a newer full `part.updated` | Defensive `chooseNewestTextValue` heuristic in `mergePartUpdate.ts:119-139` — keeps longer value if it startsWith shorter. Can pick stale text when server sends a legitimate shorter correction. | `useConversation-handlers.ts`, `types/unified-message.ts` (remove `chooseNewestTextValue` after staleDelta ships) |
| 4   | Solid `produce` mutates exact field; proxy tracks subscription                     | `reducePartDelta` L320-355 allocates new inner Map + new outer Map + new part object per token; flips top-level state object → whole tree re-renders                                              | `useConversation-handlers.ts`, NEW `useConversation-store.ts`                                                     |
| 5   | Fine-grained reactivity per field                                                  | Single `useState<StoreState>` with three `Map`s                                                                                                                                                   | NEW `useConversation-store.ts` (module-scope `Map<sessionId, SessionStore>`)                                      |
| 6   | `SKIP_PARTS = { patch, step-start, step-finish }`                                  | Already parity in `reducePartEvent` L305-306 ✅                                                                                                                                                   | No change                                                                                                         |
| 7   | Heartbeat + visibility reconnect                                                   | N/A — desktop uses IPC, not raw SSE                                                                                                                                                               | No change                                                                                                         |
| 8   | Optimistic add/remove with "newer-than-fetch" gate                                 | `fetchAndSeed` (fallback poll) can clobber in-flight deltas                                                                                                                                       | `useConversation-handlers.ts` (add fetch-epoch gate)                                                              |
| 9   | `useConversation` exposes fine-grained getters                                     | Exposes `messages: UnifiedMessage[]` rebuilt via `mergeMessages` per token; no virtualization (intentional, L82-83)                                                                               | `useConversation.ts` → `{ messageIds, getMessage, … }`                                                            |

---

## Consumer blast radius (8 files)

Consumers of `useConversation().messages` directly or transitively:

1. `src/renderer/src/components/prompt/ChatHistoryView.tsx`
2. `src/renderer/src/pages/prompt/useDeriveSessionAgentEffect.ts`
3. `src/renderer/src/pages/prompt/usePromptRuntimeState.ts` (only `.length` — trivial)
4. `src/renderer/src/pages/prompt/usePromptViewState.ts`
5. `src/renderer/src/pages/prompt/usePromptConnectionData.ts`
6. `src/renderer/src/pages/prompt/usePromptDataState.ts`
7. `src/renderer/src/pages/PromptView.tsx` L186
8. `src/renderer/src/components/prompt/chat/MessageList.tsx` (via `UnifiedMessage[]`)

Plus `src/renderer/src/types/unified-message.ts` (`mergeMessages` signature).

Out of scope: `GlobalSearch.tsx` uses a different `results.messages` (search results).

---

## Implementation plan (16 ordered steps)

### Phase A — New infrastructure (additive)

1. **NEW** `src/renderer/src/hooks/useConversation-stream-queue.ts`
   - Module-scope pending Map + staleDeltas Set.
   - `enqueue(event)` pushes into Map keyed by `${sessionId}:${msgId}:${partId}` for `part.updated`; pushes delta into array for `part.delta`.
   - When enqueueing a `part.updated`, add its `partId` to `staleDeltas` for this frame.
   - Single `requestAnimationFrame` scheduled on first enqueue per frame.
   - `flush()` drains pending; for each `part.delta`, if `staleDeltas.has(partId)` → drop. Then dispatch coalesced events to per-session store mutators.
   - Export `enqueueConversationEvent(sessionId, event)`.

2. **NEW** `src/renderer/src/hooks/useConversation-store.ts`
   - Module-scope `sessionStores = new Map<string, SessionStore>()`.
   - `SessionStore = { snapshot: { messageIds: string[], messagesById: Map<string, UnifiedMessage> }, subscribers: Set<() => void>, getSnapshot, subscribe, mutate(fn) }`.
   - `mutate(fn)` applies an immer-like or manual copy, swaps `snapshot` reference, notifies subscribers.
   - **Invariant:** snapshot reference is stable between mutations (for `useSyncExternalStore` identity check).
   - Per-message subscription: `subscribe(sessionId, messageId, cb)` wakes only when that specific message's identity changes.
   - Hooks:
     - `useConversationMessageIds(sessionId): string[]` — subscribes to the ids array only.
     - `useConversationMessage(sessionId, messageId): UnifiedMessage | undefined` — subscribes to that message only.
     - `useConversationMeta(sessionId): { isLoading, error, isAvailable }`.

### Phase B — Rewire handlers

3. **EDIT** `src/renderer/src/hooks/useConversation-handlers.ts`
   - Replace every `setState(prev => …)` with `store.mutate(snapshot => …)`.
   - Remove `chooseNewestTextValue` call site once queue's staleDelta suppression is wired (can keep as dead code in `mergePartUpdate.ts` behind a feature flag for one release).
   - Add fetch-epoch counter: increment on every `fetchAndSeed` start; on response, bail if current epoch > this fetch's epoch (prevents clobbering in-flight deltas).

4. **EDIT** `src/renderer/src/hooks/useConversation-pacing.ts`
   - Keep snapshot cache (`conversationUnifiedCache`) as-is. It's keyed by `msg.id` + signature hash and is orthogonal to storage layer.

5. **EDIT** `src/renderer/src/hooks/useConversation.ts`
   - **Breaking API change.** New return shape: `{ messageIds: string[], getMessage: (id: string) => UnifiedMessage | undefined, isLoading, error, isAvailable, refresh }`.
   - Drop `messages: UnifiedMessage[]` memo.
   - Drop `derivedMessagesCacheRef`.
   - `messageIds` comes from `useConversationMessageIds(sessionId)`.
   - `getMessage` is a stable callback that reads from the store snapshot on demand.

### Phase C — Update consumers

6. **EDIT** `src/renderer/src/types/unified-message.ts`
   - Add `mergeMessagesById(ids: string[], getMessage: (id: string) => UnifiedMessage | undefined): UnifiedMessage[]`.
   - Keep `mergeMessages` exported but mark `@deprecated` for test backward-compat.
   - Signature caches (`partSignatureCache` WeakMap, `conversationUnifiedCache`) stay.
   - **Risk note:** `partSignatureCache` is `WeakMap<Part, …>`. If handlers keep replacing the part object per delta, the WeakMap entry invalidates per token. Recommendation: keep new-part-object semantics (safe) — the `conversationUnifiedCache` keyed by `msg.id` + signature hash protects the hot path regardless.

7. **EDIT** `src/renderer/src/components/prompt/chat/MessageList.tsx`
   - Change prop from `messages: UnifiedMessage[]` → `messageIds: string[]`.
   - Render `<MessageItem key={id} sessionId={sessionId} messageId={id} />`.
   - Let `MessageItem` call `useConversationMessage(sessionId, id)` internally — so only the affected item re-renders on delta.

8. **VERIFY** `src/renderer/src/components/prompt/MessageItem.tsx` (not re-read this session)
   - Confirm it accepts `(sessionId, messageId)` and subscribes internally.
   - If currently takes `message: UnifiedMessage`, refactor to internal subscription.

9. **EDIT** `src/renderer/src/components/prompt/ChatHistoryView.tsx`
   - Accept `conversationMessageIds: string[]` + `getConversationMessage` instead of `messages`.
   - Call new `mergeMessagesById` when building `unifiedMessages` (still needed for typing indicators, tool groupings, etc. if applicable).
   - If `ChatHistoryView` only passes through to `MessageList`, it can simply forward `messageIds`.

10. **EDIT** `src/renderer/src/pages/prompt/usePromptConnectionData.ts`
    - Expose `messageIds` + `getMessage`. **Remove TODO L45-49.**

11. **EDIT** `src/renderer/src/pages/prompt/usePromptDataState.ts`
    - Same. **Remove TODO L36-37.**

12. **EDIT** `src/renderer/src/pages/prompt/usePromptViewState.ts`
    - Thread `messageIds` + `getMessage` through.

13. **EDIT** `src/renderer/src/pages/prompt/usePromptRuntimeState.ts`
    - Trivial: `messages.length` → `messageIds.length`.

14. **EDIT** `src/renderer/src/pages/prompt/useDeriveSessionAgentEffect.ts`
    - Iterate by id via `getMessage`. Likely needs to read the latest user/assistant message to derive agent — `for (const id of messageIds) { const m = getMessage(id); … }`.

15. **EDIT** `src/renderer/src/pages/PromptView.tsx` L186
    - Thread new props into `ChatHistoryView`.

### Phase D — Tests

16. **REWRITE** `src/renderer/src/hooks/useConversation.test.tsx`
    - L167 currently asserts `result.current.messages` — rewrite to `result.current.messageIds` + `result.current.getMessage(id)`.
    - Add new tests:
      - **rAF batching test:** dispatch 10 `part.delta` events synchronously, assert store mutated exactly once (mock `requestAnimationFrame`).
      - **staleDelta suppression:** enqueue `part.delta` then `part.updated` for same partId in same frame, flush, assert only the `part.updated` applied — delta dropped.
      - **per-message identity:** mutate message A, assert `getMessage('B')` returns the **same reference** as before (no cascade).
      - **coalescing:** enqueue 5 `part.updated` for same `dir:msg:part`, flush, assert only last survives.

---

## Invariants (must hold)

1. Snapshot reference from `getSnapshot()` MUST be stable until a mutation actually changes the relevant slice — `useSyncExternalStore` bails out based on `Object.is`.
2. `getMessage(id)` MUST return stable reference across renders if that message hasn't changed.
3. `messageIds` array reference MUST change when ids add/remove/reorder; MUST be stable when only message contents change.
4. A `part.delta` for `partId=X` enqueued in the same frame as a `part.updated` for `partId=X` MUST be dropped.
5. `fetchAndSeed` MUST NOT overwrite state newer than its fetch epoch.
6. `SKIP_PARTS = { patch, step-start, step-finish }` parity preserved.

---

## Risks & mitigations

| Risk                                                                                 | Mitigation                                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `partSignatureCache` WeakMap invalidates on new part object per delta                | Acceptable — `conversationUnifiedCache` keyed by `msg.id` + signature hash dominates hot path. Document in `unified-message.ts`. |
| `useSyncExternalStore` identity bugs cause either missed updates or infinite renders | Unit test snapshot identity in Phase D step 16.                                                                                  |
| Consumer forgets to use `getMessage` and captures stale snapshot                     | `getMessage` is a store getter, not a memoized value — always reads latest.                                                      |
| Removing `chooseNewestTextValue` regresses when staleDelta queue has a bug           | Keep behind feature flag `ENABLE_STREAM_QUEUE_V2` for one release; dead-code removal in follow-up.                               |
| `GlobalSearch.tsx` uses `results.messages` — confusing name                          | Out of scope. Different data source.                                                                                             |

---

## Validation commands

From `desktop/`:

```sh
npx tsc --noEmit -p tsconfig.web.json
npm test
```

There is NO `lint` or `typecheck` script in `desktop/package.json`. This is NOT an Nx repo — `nx affected` does not apply. The Sciensus-repo prompt-loop / docs-sync / git-mv / diagnostics instructions came from a different repo and most do not apply here; `git mv` for tracked file renames still does.

---

## What was read this session (so the next agent can skip re-reading)

**Reference (read-only — `/Users/josippapez/Desktop/opencode/packages/app/src/`):**

- `context/global-sdk.tsx` ✅
- `context/global-sync.tsx` ✅
- `context/global-sync/event-reducer.ts` ✅ (delta mutation L260-277, `SKIP_PARTS`)
- `context/global-sync/child-store.ts` ✅
- `context/sync.tsx` ✅

**Desktop (`/Users/josippapez/Desktop/interactive-mcp-server/desktop/src/renderer/src/`):**

- `hooks/useConversation.ts` ✅
- `hooks/useConversation-handlers.ts` ✅
- `hooks/useConversation-pacing.ts` ✅
- `hooks/useConversation.test.tsx` ✅ (L167 asserts `.messages`)
- `components/prompt/ChatHistoryView.tsx` ✅ (L82-83 no-virtualization comment)
- `components/prompt/chat/MessageList.tsx` ✅
- `types/unified-message.ts` ✅ (`mergePartUpdate.chooseNewestTextValue` L119-139)
- `pages/prompt/usePromptConnectionData.ts` ✅ (TODO L45-49)
- `pages/prompt/usePromptDataState.ts` ✅ (TODO L36-37)

**Not re-read — verify before editing:**

- `components/prompt/MessageItem.tsx` — prop shape
- `pages/prompt/usePromptViewState.ts`
- `pages/prompt/usePromptRuntimeState.ts`
- `pages/prompt/useDeriveSessionAgentEffect.ts`
- `pages/PromptView.tsx` L186

---

## Final note

Start with Phase A (additive, no breaking changes). Land it behind `ENABLE_STREAM_QUEUE_V2` flag. Validate rAF batching + staleDelta in isolation via tests. Then Phase B–C as the breaking API change, in one PR so consumers migrate atomically. Phase D tests ship with Phase C.
