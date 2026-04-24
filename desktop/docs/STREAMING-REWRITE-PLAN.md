# Streaming Rewrite Plan — Fresh Implementation

> **Superseded by the pull-on-invalidation session-tree model (2026-04).** `session/tree-manager/*` has been replaced by `session/session-tree-service.ts` (no cache; pull on `session-tree-invalidated`). References below to `tree-manager` are retained for historical context only — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`IPC-API.md`](./IPC-API.md) for current behaviour.

> **Status**: PLAN (awaiting user approval before Phase C implementation).
> **Supersedes**: `STREAMING-PERF-HANDOFF.md` (legacy rAF queue plan), `GLOBAL-STREAM-MIGRATION-PLAN.md` (pre-rewrite migration notes).
> **Date**: 2026-04-22. Branch: `feat/ai-elements-chat-upgrade`.

## 1. Context

Phase A of this rewrite **deleted** all pre-existing SSE / streaming code from `desktop/src/`:

- Removed: `src/main/session/tree-manager/sse-subscription.ts`, `src/main/opencode/bus-events.ts`, `bus-event-handler.ts`, `bus-event-forwarders.ts`, `bus-event-utils.ts`, whole `src/main/conversation/` folder, renderer `useConversation*` hooks.
- Rewrote `src/main/session/tree-manager.ts` as REST-seed-only (no live events).
- Stubbed `usePromptConnectionData` + `usePromptDataState` consumers so the build compiles with an empty message list.
- Deleted all 107 tests and the `vitest` toolchain.
- Main-process typecheck ✓, renderer build ✓ in ~10 s.

Preload listeners (11 orphan channels) and REST IPC slots (`fetch-conversation-messages`, `is-conversation-available`) **remain declared** in `src/preload/api/events.ts` and `src/preload/api/sessions.ts`; the fresh pipeline plugs back into them, so no preload API renegotiation is needed.

Goal of Phase C: **a near-instant, performant live streaming pipeline**, patterned on OpenCode's own Solid web app (`~/Desktop/opencode/packages/app`) — the most hardened reference — adapted for Electron + React.

## 2. Reference architecture (what we copy)

### 2.1 From `packages/app` (OpenCode Solid web app)

- **Transport**: fetch-based SSE (not `EventSource`) via the SDK's `client.global.event({ signal })` async iterator. Custom headers, precise abort, exponential backoff capped at 30 s.
- **Reconnect**: two layers — SDK backoff + outer `while (!aborted)` loop with `RECONNECT_DELAY_MS = 250` ms and a **15 s heartbeat** (`HEARTBEAT_TIMEOUT_MS`); no event in 15 s → abort + reconnect. Also `visibilitychange` re-check.
- **Coalescing** (critical): `Map<semantic-key, queue-index>` + `staleDeltas: Set<string>`. For `message.part.updated` / `session.status` / `lsp.updated`, the latest event replaces a queued earlier one in place. Superseded `part.delta` events are dropped.
- **Double-buffer + 16 ms frame flush + 8 ms cooperative yield** (`STREAM_YIELD_MS`) so bursts collapse into one render per animation frame and never starve the UI thread.
- **Split state**: `message[sessionID]: Message[]` (sorted by id, binary-searched) + `part[messageID]: Part[]` (sorted by id). A text delta mutates one string field only → fine-grained reactivity (or in React: selector-keyed subscriptions) keep re-renders minimal.
- **Merge semantics**: `reconcile({ key: 'id' })` for whole-object updates, `produce(draft)` string-append for deltas.

### 2.2 From `packages/opencode` (TUI — same reducer shape, different transport)

- The TUI **already supports injection** of an external events source (`props.events.subscribe(handleEvent)` in `sdk.tsx:112-120`). This proves the reducer/store layer is transport-agnostic and validates placing SSE in a separate process and feeding events over a bridge.
- TUI enforces a **100-message cap** per session (`sync.tsx:253-270`). Adopt this for long-lived Electron windows.
- TUI skips `patch` / `step-start` / `step-finish` part types (`SKIP_PARTS`). We will do the same.

### 2.3 What we deliberately **do not** copy

- We will NOT use Solid primitives (`produce`/`reconcile`/Solid stores). React 19 + Zustand (already a repo dep via `jotai`/`@tanstack/store`) + Immer-style targeted updates on `Map`/`Array` structures are the React equivalent.
- We will NOT use the SDK's client-side SSE iterator from inside the renderer. The renderer is a browser; we want one connection per _app_, not per _window_, surviving renderer reloads and DevTools refreshes. SSE lives in **main**.

## 3. Target architecture

```
┌──────────────────── main (Node) ────────────────────┐
│                                                     │
│  opencode/event-stream.ts                           │
│    ├── undici fetch('/event')  ──────── SSE ───────►│
│    ├── line-parser (copied from SDK)                │
│    ├── AbortController (one per attempt)            │
│    ├── outer reconnect loop (250 ms, max attempts∞) │
│    ├── 15 s heartbeat → force reconnect             │
│    ├── coalescing queue (Map<semKey, qIdx>)         │
│    ├── staleDeltas set                              │
│    ├── 16 ms frame flush → batch dispatch           │
│    └── 8 ms cooperative yield                       │
│                                                     │
│  opencode/event-bridge.ts                           │
│    └── webContents.send('conversation-batch', ...)  │
│                                                     │
│  opencode/conversation-rest.ts                      │
│    ├── ipcMain.handle('fetch-conversation-messages')│
│    └── ipcMain.handle('is-conversation-available')  │
│                                                     │
│  lifecycle in main/index.ts                         │
│    └── start/stop on OpenCode port & settings       │
│                                                     │
└─────────────────────────────────────────────────────┘
                           │ IPC (single channel carries batched events)
                           ▼
┌─────────────────── renderer (React) ────────────────┐
│                                                     │
│  store/conversation-store.ts                        │
│    ├── messages: Map<sessionID, Map<msgID, Msg>>    │
│    ├── messageOrder: Map<sessionID, string[]>       │
│    ├── parts: Map<msgID, Map<partID, Part>>         │
│    ├── partOrder: Map<msgID, string[]>              │
│    ├── sessionStatus: Map<sessionID, Status>        │
│    ├── contextUsage: Map<sessionID, Usage>          │
│    └── 100-msg cap per session (trim oldest)        │
│                                                     │
│  store/conversation-reducer.ts (pure)               │
│    └── (state, event) => newState   using Immer     │
│                                                     │
│  hooks/useConversation.ts                           │
│    ├── REST seed on (sessionID) change              │
│    ├── subscribe to 'conversation-batch' IPC        │
│    ├── `useSyncExternalStore` to selected slice     │
│    └── returns { messages, available }              │
│                                                     │
│  pages/prompt/usePromptConnectionData.ts            │
│    └── replace EMPTY_MESSAGES stub with hook call   │
│                                                     │
│  existing UI (unchanged)                            │
│    └── mergeMessages → ChatHistoryView → MessageItem│
│                                                     │
└─────────────────────────────────────────────────────┘
```

Single IPC channel `conversation-batch` carries pre-coalesced batches; renderer reducer dispatches one state update per batch. This is the Electron equivalent of the web app's "one `batch()` per flush".

> **Deferred decision**: **`webContents.send` vs `MessageChannelMain`**. Starting with `webContents.send` (simpler, matches existing preload). Upgrade to `MessageChannelMain` as a perf optimization ONLY if profiling shows IPC serialization becoming a bottleneck (very unlikely at ~60 batches/sec).

## 4. Event schema (what flows over the IPC bridge)

Batch shape:

```ts
type ConversationBatch = {
  flushedAt: number; // main-side monotonic timestamp
  events: ConversationEvent[]; // already coalesced, deduped, ordered
};

type ConversationEvent =
  | { t: 'message.created'; sessionId: string; message: ConversationMessage }
  | { t: 'message.updated'; sessionId: string; message: ConversationMessage }
  | { t: 'message.completed'; sessionId: string; messageId: string }
  | { t: 'message.removed'; sessionId: string; messageId: string }
  | {
      t: 'part.updated';
      sessionId: string;
      messageId: string;
      part: ConversationMessagePart;
    }
  | {
      t: 'part.delta';
      sessionId: string;
      messageId: string;
      partId: string;
      field: 'text' | 'reasoning';
      delta: string;
    }
  | { t: 'part.removed'; sessionId: string; messageId: string; partId: string }
  | { t: 'session.status'; sessionId: string; status: SessionStatus }
  | { t: 'session.idle'; sessionId: string }
  | { t: 'session.compacted'; sessionId: string; summary?: string }
  | { t: 'todo.updated'; sessionId: string; todos: Todo[] }
  | { t: 'vcs.updated'; branch: string }
  | { t: 'file.edited'; sessionId: string; path: string };
```

- Coalescing keys (main-side): `${t}:${sessionId}:${messageId}:${partId}` or subset per event type.
- `part.delta` is NEVER coalesced — it's an append primitive. It IS superseded when a `part.updated` for the same `(messageId, partId)` is enqueued behind it.

Types `ConversationMessage` / `ConversationMessagePart` continue to live in `src/preload/api/types.ts` (they survived deletion). SDK-to-IPC mapping is an inline pure function in `event-bridge.ts` — no separate mapper module (the deleted `opencode-mappers.ts` was over-factored).

## 5. File-level design

### New files (main)

| Path                                             | LOC target | Purpose                                                                                                                            |
| ------------------------------------------------ | ---------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/opencode/event-stream.ts`              |       ~220 | Owns SSE loop + heartbeat + coalescing queue + 16 ms flush. Exports `start(deps)`, `stop()`.                                       |
| `src/main/opencode/event-bridge.ts`              |        ~80 | Maps raw OpenCode events → `ConversationEvent[]`, sends `conversation-batch` via `webContents.send`. Injected into `event-stream`. |
| `src/main/opencode/conversation-rest.ts`         |        ~60 | `ipcMain.handle('fetch-conversation-messages', (_, { sessionId }) => ...)` and `is-conversation-available`.                        |
| `src/main/ipc/handlers/conversation-handlers.ts` |        ~30 | Thin registration shim called from `handlers.ts`.                                                                                  |

### New files (renderer)

| Path                                             | LOC target | Purpose                                                                                                                                                |
| ------------------------------------------------ | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/renderer/src/store/conversation-store.ts`   |       ~180 | Zustand store with split maps + order arrays + 100-msg cap + selectors. Vanilla store (no provider) for external subscription use.                     |
| `src/renderer/src/store/conversation-reducer.ts` |       ~200 | Pure `(state, event) => state`. Immer-free for the hot delta path (direct `Map` mutation inside a `set` call, new Map instance per session on change). |
| `src/renderer/src/hooks/useConversation.ts`      |        ~80 | Mount-effect seeds via REST; subscribes to `onConversationBatch` IPC; uses `useSyncExternalStore` to return per-session `{ messages, available }`.     |
| `src/renderer/src/hooks/useConversationStore.ts` |        ~40 | Generic `useSyncExternalStore` selector hook over the vanilla store.                                                                                   |

### Files modified

| Path                                                       | Diff                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/preload/api/events.ts`                                | Add `onConversationBatch` listener. Optionally remove 11 orphan listeners declared earlier, replaced by the single batch channel. |
| `src/preload/api/sessions.ts`                              | Confirm `fetchConversationMessages` + `isConversationAvailable` invoke paths exist (they do).                                     |
| `src/preload/index.ts`                                     | Barrel export `onConversationBatch`.                                                                                              |
| `src/main/ipc/handlers.ts`                                 | Register `conversation-handlers`.                                                                                                 |
| `src/main/index.ts`                                        | Start `event-stream` after OpenCode server is healthy; stop on `before-quit`.                                                     |
| `src/main/opencode/index.ts`                               | Re-export `startEventStream` / `stopEventStream`.                                                                                 |
| `src/renderer/src/pages/prompt/usePromptConnectionData.ts` | Replace `EMPTY_MESSAGES`/`false` stubs with `useConversation(providerSessionId)`.                                                 |
| `src/renderer/src/pages/prompt/usePromptDataState.ts`      | Same.                                                                                                                             |

## 6. Performance targets

| Metric                                                                    | Target                                       | Measurement                                                                |
| ------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| First-byte → first-paint (assistant starts streaming → first char in DOM) | **≤ 50 ms**                                  | manual stopwatch + `performance.mark` in `MessageItem`                     |
| Steady-state delta latency (server delta → visible text)                  | **≤ 33 ms p95** (one 60-fps frame + IPC hop) | log the main-side flush → renderer `useSyncExternalStore` notify roundtrip |
| CPU use during 30 s of continuous streaming                               | **< 25 %** on M-series Mac                   | Activity Monitor + `process.cpuUsage()` in main                            |
| React renders per second during burst                                     | **≤ 60**                                     | React Profiler                                                             |
| Memory growth during 30-min session                                       | **< 30 MB**                                  | `process.memoryUsage().heapUsed` sampling                                  |

Targets derived from observations of the OpenCode web app on the same machine.

## 7. Rollout order (Phase C sub-steps)

1. **C1 — main/event-stream scaffold**: non-SSE prototype that emits a batch every 16 ms with a fake event, verify IPC delivery lights up `useConversation`. Ship with a feature flag `experimental.liveStream` defaulted off.
2. **C2 — main SSE connection**: real `client.global.event` wiring, heartbeat, reconnect, coalescing queue. Unit-debug via `/tmp/event-stream-*.log`.
3. **C3 — renderer store + reducer**: implement `conversation-store.ts` + `conversation-reducer.ts`, seed via REST on session select, consume batches. Keep React renders bounded via split selectors.
4. **C4 — UI reconnect**: replace stubs in `usePromptConnectionData.ts` + `usePromptDataState.ts`. Verify `ChatHistoryView` paints live.
5. **C5 — status/todo/vcs/context re-wiring**: make `useSessionStatus`, `useTodos`, `useVcsInfo`, `useContextUsage` read from the same store (either as slices of `conversation-store` or as tiny sibling stores populated by the same reducer).
6. **C6 — trim preload orphans**: delete the 11 orphan `onX` listeners in `preload/api/events.ts` (replaced by `onConversationBatch`). Update renderer call-sites.
7. **C7 — polish**: `content-visibility: auto` on `MessageItem`, staged mount for back-scroll, 100-msg cap enforcement, React.memo comparator on `MarkdownContent`.
8. **C8 — flag flip + perf validation**: remove feature flag, run perf targets, ship.

Each sub-step is independently mergeable; each ends with `npx electron-vite build` green and a manual streaming test.

## 8. Open questions (need user input before starting C1)

1. **State library**: use Zustand directly (plain `create<State>()(set => ...)`) or layer on top of the existing `@tanstack/store` to stay consistent with `session-graph.ts`? **Recommendation: `@tanstack/store` + `useStore` — already in deps, same idioms as the existing code.**
2. **Feature flag during rollout**: add a dev-only toggle in settings UI, or a simple `process.env.OC_DESKTOP_LIVE_STREAM` env-based gate? **Recommendation: env-based gate only — we're pre-release, no need for settings surface.**
3. **Drop the 11 orphan preload listeners now or after C7?** Deleting sooner reduces dead code but means consumers that depend on them (`useSessionStatus`, etc.) must be rewired in lockstep. **Recommendation: keep for now, consolidate in C6.**
4. **Status/todo/vcs events**: merge into `conversation-batch` or keep separate channels? Merging simplifies IPC but couples previously independent features. **Recommendation: merge — one IPC hop, one render pass, simpler coalescing.**
5. **Should `event-stream` own the session-tree seeding too?** Currently `tree-manager.ts` does its own REST seed on startup. **Recommendation: no — keep tree-manager as-is for the sidebar; `event-stream` is chat-centric.**

## 9. Risks

- **IPC backpressure**: `webContents.send` is not synchronous; if the renderer freezes (e.g., during a large DevTools operation), batches pile up in main. Mitigation: main-side ring buffer capped at 5 batches (older ones are merged into newer before flush).
- **Session switching race**: user switches away mid-stream → new session's REST seed races against arriving events of the old session. Mitigation: reducer is keyed by `sessionId`; renderer only renders the active session's slice.
- **Electron renderer reload during dev**: SSE connection stays alive in main; new renderer subscribes fresh and receives next batch. REST seed repopulates state. Already tested with the web app's equivalent pattern — works.
- **Main-process crash**: SSE dies with it; user restarts. Not worth surviving.

## 10. Test strategy

User has explicitly removed all automated tests. Verification is **manual** for Phase C:

- Send streaming prompts to opencode server, visually confirm:
  - Assistant text appears within ~50 ms of first server byte.
  - Text grows smoothly without jumps or flicker.
  - Multiple deltas per frame don't cause excess re-renders (React DevTools profiler).
  - Session switch mid-stream lands the stream on the correct session.
  - Reconnect recovers after `kill -STOP` / `kill -CONT` on opencode server.
  - Long (5-min) streaming session stays below 30 MB growth.

If the user later reintroduces automated tests, tests should target: reducer purity, coalescing invariants, and the IPC message format — not the React rendering layer.

---

## Appendix A — Reference file inventory

- Reference web app: `/Users/josippapez/Desktop/opencode/packages/app/src/context/global-sdk.tsx`, `global-sync.tsx`, `global-sync/event-reducer.ts`, `global-sync/child-store.ts`, `global-sync/session-cache.ts`, `global-sync/eviction.ts`, `global-sync/queue.ts`.
- Reference TUI: `/Users/josippapez/Desktop/opencode/packages/opencode/src/cli/cmd/tui/context/sdk.tsx`, `context/event.ts`, `context/sync.tsx`, `routes/session/index.tsx`, `routes/session/message-timeline.tsx`.
- Surviving desktop UI: `desktop/src/renderer/src/components/prompt/ChatHistoryView.tsx`, `MessageItem.tsx`, `chat/MessageList.tsx`, `types/unified-message.ts`.
- Surviving desktop IPC slots: `desktop/src/preload/api/events.ts`, `desktop/src/preload/api/sessions.ts`.
- Surviving SDK wiring: `desktop/src/main/opencode/sdk-client.ts`, `session-api.ts`.

## Appendix B — Deferred / canceled

- The old `STREAMING-PERF-HANDOFF.md` plan (rAF queue + `useSyncExternalStore` bolted onto the legacy `useConversation`) is **superseded**. Delete that file at the end of Phase C.
- The old `GLOBAL-STREAM-MIGRATION-PLAN.md` described a migration from per-session event subscriptions to a single `/global/event`. That migration has been completed and then removed; the doc can be archived to `docs/archive/` at the end of Phase C.
