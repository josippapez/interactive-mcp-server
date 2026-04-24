# UI Performance Diagnosis — Electron Desktop App

Investigation-only report. No files were modified. Evidence cited as `path:line`.

## Executive summary

1. **🔥 Primary culprit — synchronous file logging in the 16 ms flush loop.** `main/utils/logger.ts:87` uses `fs.appendFileSync`, and `main/opencode/event-stream.ts:219–223` emits `log.info('[perf.flush] …')` **on every flush** while streaming. With the 16 ms cadence that is ~60 synchronous disk writes/sec on the main process during any streaming turn. This alone matches the user-reported "multiple-per-second log spam" and would stall IPC + window messaging. `PERF_ENABLED` (`event-stream.ts:52`) is gated only by `NODE_ENV !== 'production'`, so every dev run pays the cost.
2. **🔥 `mergeMessages` runs full-cost on every streaming delta.** `ChatHistoryView.tsx:194–217` memoizes on `conversationMessages` identity, which changes on every part-delta (see #3). `mergeMessages` (`types/unified-message.ts:563–641`) re-walks the message list twice, re-runs `filterMessageText` regex per message, calls `hashParts` which **iterates the signature string char-by-char** (`unified-message.ts:423–425`), and the streaming part misses `partSignatureCache` (WeakMap keyed on part-object identity — Immer produces a new object each tick). Then `.sort()` + `pruneCache` walk the cache Maps. O(messages) with a string-hash per message, per delta.
3. **🔥 Batch reducer does NOT collapse into a single `produce()`.** `conversation-reducer.ts:371–398` — the JSDoc claims batching collapses events, but the implementation calls `applyConversationEvent(acc, ev)` per event, and each handler (`applyPartDelta`, `applyPartUpdated`, `applyMessageUpdated`, etc.) wraps its work in its own `produce(...)`. A 30-event batch = 30 top-level state drafts + 30 root-state copies. `applyPartDelta` also returns a **new `state.parts` object and new `parts[messageId]` array** on every text delta (`conversation-reducer.ts:184–202`), invalidating the `cached.parts === state.parts` fast path in `useConversation.ts:168`.
4. **HIGH — sidebar refilter/resort on every `session.status` event.** `useSessionStatus` returns a fresh `statusMap` object every render and a new `getStatus` callback whenever `rawStatus` changes (`hooks/useSessionStatus.ts:81–93`). `useSessionFiltering` depends on `getStatus` transitively through `isNodeRunning` → `sortNodes` → `filteredProjects`/`filteredDirectConnections` (`sidebar/useSessionFiltering.ts:32–124`). Every status event during streaming invalidates both memos and the sidebar re-filters + re-sorts the entire tree. `filterByActivity`'s parent-chain lookup at L71 is `nodes.find(...)` inside a `while`, i.e. **O(N × depth)** per filter pass.
5. **MEDIUM — renderer-side sync console logging** (`[perf.hop]` `conversation-store.ts:54–60`, `[perf.first-paint]` `MessageItem.tsx:115–131`) amplifies the same 16 ms cadence in the renderer. Electron's devtools console pipe is synchronous; under sustained streaming this competes with React renders.

Recommended immediate action: kill the `[perf.*]` logs (or make `logger.ts` async-buffered), then re-profile. This single change is expected to resolve the bulk of the visible lag. H2/H3 are the next tier.

## Hypothesis verdicts

### H1 — Health-check flood — ❌ NOT A CAUSE

- Steady-state poll is **10 s**, not sub-second (`store/opencode-health.ts:33,226`). Only one consumer (`StatusBar.tsx:39`).
- Cold-start probe (`main/index.ts:44–58`) polls 500 ms but is bounded ≤30 s and fires once.
- Main handler logs at `ipc/handlers/opencode-status-handlers.ts:36–53` — only runs every 10 s, not per-frame.
- The user-observed "multiple logs per second" is NOT this; see H6.
- **Fix size: n/a.**

### H2 — Message list re-rendering — ✅ LIKELY (MAJOR)

- `mergeMessages` full re-run every streaming delta (`ChatHistoryView.tsx:194–217` + `unified-message.ts:563–641`). Per-delta cost:
  - Two passes over `conversationMessages` (L575 prefix, L620 conversion).
  - `filterMessageText` regex + `shouldHideUnifiedMessage` per message (`unified-message.ts:215–255`).
  - `hashParts` char-by-char loop on the **full** signature string for the streaming message — WeakMap cache (`unified-message.ts:286–303`) misses because Immer replaces the part object on every delta.
  - `unified.sort(...)` at L638; `pruneCache` at L634–635 iterating two module-level `Map`s.
- `useConversation.ts:157–208` — the selector IS well-designed (reuses `prevJoined.parts === partList` and shallow-equal branch, L185–198). But it still allocates a new `joined[]` and a new `cached.messages` Map snapshot every delta.
- `MessageItem` (`components/prompt/MessageItem.tsx:70,593`) and `MessageList` (`components/prompt/chat/MessageList.tsx:71,248`) are both correctly `memo`'d; stable empty defaults (`EMPTY_EXCLUSIONS`, `EMPTY_MATCHED_IDS`) in place. `contentVisibility: auto` containment at `MessageItem.tsx:489–491,555–557` helps paint cost. So the problem is upstream (merge/reducer), not the list primitives.
- **Impact: large. Fix size: M.**

### H3 — Channel navigation re-seed — ❌ MOSTLY NOT A CAUSE

- `useConversation.ts:80–109` has correct `seededSessions` dedup + store-fast-path skip (L90–94).
- `seedConversationMessages` (`conversation-reducer.ts:409–417`) has `existing.length >= messages.length` early-return.
- `isSeeding` flag is set/cleared correctly; `needsFetch` at L268–271 is well-scoped.
- Navigation slowness is explained by H2 (full `mergeMessages` on switch, new `conversationMessages` identity) + H5 (sidebar re-filter during status churn) + H6 (log flush during initial render).
- **Fix size: n/a.**

### H4 — GSAP animations — ❌ NOT A HOT-PATH CAUSE

- Hot paths inspected:
  - `ToolCallView.tsx:94–111` — expand/collapse only, user-initiated.
  - `ChannelItem.tsx:49–60` — mount-only animation; `ChannelItem` is `memo`'d (L37) and receives stable `node` refs from the session-graph store, so it won't re-run per filter pass. Only on actual mount/unmount.
  - `PromptView.tsx:49–60` — one-shot shell mount.
  - `IdleStateView.tsx:54–60` — only when idle screen mounts.
- No GSAP on list items during streaming. CSS `animate-spin` (`MessageItem.tsx:241`, `ChatHistoryView.tsx:553`) is GPU-cheap.
- **Fix size: n/a.**

### H5 — Sidebar re-filter/re-sort — ✅ LIKELY (MEDIUM/HIGH during streaming)

- Root cause: `useSessionStatus` (`hooks/useSessionStatus.ts:55–100`) — `rawStatus` comes from the conversation store (`state.status` slice, L58–61). Every `session.status` event (or any other `status` mutation) returns a new `rawStatus` reference, which:
  - Rebuilds `statusMap` object unconditionally (L90–93).
  - Gives `getStatus` a new identity (L81–88).
- Cascades into `useSessionFiltering.ts`:
  - `isNodeRunning` memo invalidates (L32–42) → `filterByActivity` invalidates (L54–85) → `sortNodes` invalidates (L88–110) → **both** `filteredProjects` and `filteredDirectConnections` memos invalidate (L112–124).
- `filterByActivity` parent walk is **O(N × depth)**: `nodes.find(...)` inside `while` at L69–75. For ≥ a few dozen sessions with nesting this is measurable per pass.
- `sortNodes` (L88–110) always returns a new array via `[...nodes].sort(...)` — so even if no status changed materially, the filtered-projects identity changes, re-rendering `ProjectSection` subtrees.
- `providerCounts` (L133–146) does 4 full filters over `allNodes` — minor.
- **Impact: medium (large when session tree > ~30 nodes). Fix size: S/M.**

### H6 — Console / file-log storm — ✅ CRITICAL 🔥

- **Main process:** `main/utils/logger.ts:87–94` writes every single log line via `fs.appendFileSync`. Synchronous fs from the Electron main process blocks the event loop, IPC dispatch, and BrowserWindow messaging.
- **Main process hot log:** `main/opencode/event-stream.ts:219–223` runs `log.info('[perf.flush] seq=… count=… flushedAt=…')` inside `flushPending()`, which is called by the 16 ms `perfTimer` (L61, L181–227). During active streaming this is ~60 sync disk writes/sec.
- Gate: `PERF_ENABLED = process.env.NODE_ENV !== 'production'` (`event-stream.ts:52`). Dev mode pays the full cost unconditionally.
- **Renderer process:** `[perf.hop]` log in `conversation-store.ts:54–60` on every applied batch. `[perf.first-paint]` in `MessageItem.tsx:115–131` for every first-paint (includes effects logging to `window.console`).
- Electron `console.log` in the renderer is piped across the devtools bridge synchronously when devtools is open.
- Additional logs that compound: the IPC main-side `[conversation-store] seeded/coalesced …` logs from batch delivery (not read in this pass but referenced by the code patterns elsewhere), if still present, sit on the same path.
- **Impact: very large (explains reported symptom directly). Fix size: S.**

### H7 — IPC serialize cost — ❌ NOT A CAUSE

- Seed capped at 50 (`useConversation.ts:73` `SEED_LIMIT=50`).
- Delta payloads are small (string deltas + metadata), coalesced by the main-side flush buffer.
- No `JSON.parse(JSON.stringify(...))` or large structured-clone operations observed in the hot path.
- **Fix size: n/a.**

## Top-5 prioritized fixes

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Files / lines                                                                                                                   | Impact                                          | Size | Risk                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---- | ----------------------------------------- |
| 1   | **Gate `[perf.flush]` and all `[perf.*]` logs behind an explicit env flag (e.g. `OPENCODE_PERF_LOG=1`)**, NOT `NODE_ENV !== 'production'`. Default off even in dev. Same treatment for renderer `[perf.hop]` (`conversation-store.ts:54–60`) and `[perf.first-paint]` (`MessageItem.tsx:115–131`).                                                                                                                                                                                                                                                      | `main/opencode/event-stream.ts:52,219–223`; `store/conversation-store.ts:46,54–60`; `components/prompt/MessageItem.tsx:115–131` | 🔥 Very high                                    | S    | Trivial                                   |
| 2   | **Convert `logger.ts` to async/buffered appends.** Use `fs.createWriteStream` with a bounded queue, or `fs.promises.appendFile` behind a single-writer queue. Rotate behavior unchanged.                                                                                                                                                                                                                                                                                                                                                                | `main/utils/logger.ts:87–124`                                                                                                   | High (even after #1, because other logs remain) | S    | Low — cover startup/shutdown flush        |
| 3   | **Collapse `applyConversationBatch` into a single `produce()`** as the JSDoc already promises. Stop creating a new `state.parts` object when no part list changed; mutate in the existing draft. Inside `applyPartDelta`, if the target part array already contains the message-id entry, mutate the draft part's text in place instead of returning a new `parts[messageId]` array.                                                                                                                                                                    | `store/conversation-reducer.ts:184–202,371–398`                                                                                 | High                                            | M    | Medium — needs selector-invariants review |
| 4   | **Memoize `mergeMessages` by a stable composite key** (e.g. `[channelRef, conversationRef, activePromptId, filterFlags]`) at the call site in `ChatHistoryView.tsx:194–217`, returning the cached result when all refs are `===`. Additionally, short-circuit `hashParts` on the streaming message: when the part's text length changes but type/tool/metadata don't, reuse the previous signature with the new length appended — skip the char-loop hash entirely. Make `pruneCache` time-bounded (don't run on every call; gate on a size threshold). | `components/prompt/ChatHistoryView.tsx:194–217`; `types/unified-message.ts:354–429,505–514,563–641`                             | High                                            | M    | Medium — cache coherency tests needed     |
| 5   | **Stabilize `useSessionStatus`** — return a cached `statusMap` object (only rebuild when keys/values actually change) and keep `getStatus` stable across renders by reading from a ref. In `useSessionFiltering.ts:54–85`, replace the `nodes.find(...)` parent walk with a pre-built `Map<providerSessionId\|id, SessionNode>` computed once per `nodes` identity; memoize `sortNodes`' output tuple so identity is preserved when inputs unchanged.                                                                                                   | `hooks/useSessionStatus.ts:55–100`; `components/prompt/sidebar/useSessionFiltering.ts:32–124`                                   | Medium                                          | S/M  | Low                                       |

## Instrumentation suggestions (to confirm before/after)

1. **Quickest A/B test for H6**: temporarily comment out `log.info('[perf.flush] …')` at `event-stream.ts:219–223` and the two renderer `[perf.*]` logs. Re-run streaming. If lag drops sharply, H6 is confirmed as dominant.
2. **Main-process log file growth**: watch the log file (path defined in `logger.ts` — not read here) while streaming a long turn. File growth of hundreds of KB per turn confirms the sync-append storm.
3. **React DevTools Profiler** in the renderer during a streaming turn. Expect `ChatHistoryView` to dominate commit time with the `useMemo` for `mergedMessages` showing as the hot entry. After fix #4, that commit slice should drop ~order of magnitude for long conversations.
4. **`performance.mark`/`measure` around `mergeMessages`** in `ChatHistoryView.tsx:194–217` (behind the same new `OPENCODE_PERF_LOG` flag). Report mean + p95 duration per commit across a 30s streaming burst.
5. **Sidebar render counter**: add a `useRenderCount` dev-only probe inside `ChannelSidebar` / `ProjectSection` (behind the flag). During a streaming turn with no channel switch, the count should stay flat after fix #5; currently it will tick up on every session-status event.
6. **IPC throughput counter (already partially there)**: verify `conversation-batch` payload size distribution via the existing batch metadata. If batches are consistently small (< 4 KB) the argument against H7 is airtight.

## Ruled-out / red herrings

- **H1 health-check flood** — 10 s poll, single consumer, not in hot path.
- **H3 channel re-seed** — seed dedup + store-fast-path + `existing.length >= messages.length` guard all work correctly.
- **H4 GSAP** — all animations are mount-only on memoized subtrees; no list-wide animation runs during streaming.
- **H7 IPC serialization** — 50-message seed cap, coalesced deltas, small payloads.
- **`contentVisibility: auto` containment** (`MessageItem.tsx:489–491,555–557`) — already present, helping paint cost. Leave as is.
- **Selector over-render in `useConversation`** — the selector at `useConversation.ts:157–208` is actually well-designed (reuses prev joined array per-message when parts unchanged). It's upstream churn (new `state.parts` ref every delta) that defeats its fast path. Fix #3 addresses the root, not the selector.
- **Session-graph store / 4 s main-side tree poll** (`main/session/tree-poller.ts:27,109`) — cadence is fine. Not a contributor.

## Appendix — files inspected

Main process:

- `src/main/utils/logger.ts` (sync `appendFileSync`)
- `src/main/opencode/event-stream.ts` (perf timer, `[perf.flush]` log)
- `src/main/opencode/health.ts`
- `src/main/ipc/handlers/opencode-status-handlers.ts`
- `src/main/ipc/handlers/conversation-handlers.ts`
- `src/main/index.ts` (cold-start probe)
- `src/main/session/tree-poller.ts`

Renderer — stores/reducers:

- `src/renderer/src/store/opencode-health.ts`
- `src/renderer/src/store/conversation-store.ts`
- `src/renderer/src/store/conversation-reducer.ts`

Renderer — hooks:

- `src/renderer/src/hooks/useConversation.ts`
- `src/renderer/src/hooks/useOpenCodeHealth.ts`
- `src/renderer/src/hooks/useSessionStatus.ts`

Renderer — components:

- `src/renderer/src/components/StatusBar.tsx`
- `src/renderer/src/components/prompt/MessageItem.tsx`
- `src/renderer/src/components/prompt/chat/MessageList.tsx`
- `src/renderer/src/components/prompt/chat/message-list-helpers.ts`
- `src/renderer/src/components/prompt/chat/auto-scroll-signature.ts`
- `src/renderer/src/components/prompt/ChatHistoryView.tsx`
- `src/renderer/src/components/prompt/ChannelSidebar.tsx`
- `src/renderer/src/components/prompt/sidebar/useSidebarState.ts`
- `src/renderer/src/components/prompt/sidebar/useSessionFiltering.ts`
- `src/renderer/src/components/prompt/sidebar/ChannelItem.tsx`

Renderer — types/lib:

- `src/renderer/src/types/unified-message.ts`
- `src/renderer/src/lib/gsap.ts`

Not inspected (low expected signal after findings above):

- `ProjectSection.tsx`, `ProjectRail.tsx`, `ProjectsSection.tsx` — re-render behavior follows from H5 conclusions.
- `ToolCallView.tsx` expand/collapse details — H4 ruled out.
- `useRealtimeData.ts`, `useHistoryWindow.ts`, `useAutoScroll.ts` — no per-delta expensive work observed in callers.
