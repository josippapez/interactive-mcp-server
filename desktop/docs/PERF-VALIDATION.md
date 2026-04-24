# Perf Validation — Phase C streaming pipeline

Manual validation guide for the 5 metrics in
[`STREAMING-REWRITE-PLAN.md` §6](./STREAMING-REWRITE-PLAN.md#6-performance-targets).

Dev-only instrumentation is compiled into development builds only; in
production builds (`NODE_ENV=production` main / Vite `DEV=false` renderer)
none of the logs fire and there is zero overhead.

---

## How to run

```sh
cd desktop
npm run dev
```

Open an OpenCode session and send a prompt that produces a long streaming
reply (anything > ~5s of continuous tokens). Keep DevTools open in the
renderer and watch the main-process terminal.

---

## Metric #1 — First-byte → first-paint (target ≤ 50 ms)

**What it measures:** time from when a newly coalesced batch containing
the first assistant content chunk leaves the main process, to when that
content is actually rendered in the DOM.

**Where the numbers are:**

- Main terminal: `[perf.flush] seq=N count=X flushedAt=<ms>` — the
  server timestamp at which the batch was sent.
- Renderer console: `[perf.first-paint] msgId=<id> chars=<n> at=<ms>` —
  fires once per assistant message, the first time it renders with
  non-empty content.

**Computing the value:**

1. Find the first `[perf.flush]` line after you submit the prompt.
2. Find the `[perf.first-paint]` line for that response's message id.
3. `at - flushedAt` ≈ first-byte → first-paint. Should be ≤ 50 ms.

A `performance.mark('perf.first-paint:<msgId>')` is also emitted so you
can correlate against the React Profiler timeline.

---

## Metric #2 — Steady-state delta latency (target ≤ 33 ms p95)

**What it measures:** main-side flush → renderer store-apply roundtrip
(one 60-fps frame + IPC hop).

**Where the numbers are:**

- Renderer console: `[perf.hop] seq=N count=X hopMs=<ms>` — fires on
  every batch. `hopMs = Date.now() - batch.flushedAt`.

**Computing p95:**

During a 30s continuous stream, copy the console into a scratch file and:

```sh
grep -Eo 'hopMs=[0-9]+' /tmp/hop.log | awk -F= '{print $2}' | sort -n | \
  awk 'BEGIN{c=0} {a[c++]=$1} END{print a[int(c*0.95)]}'
```

p95 should be ≤ 33 ms.

> ⚠️ Clock skew note: `Date.now()` is used on both sides. Main and renderer
> share the same monotonic wall clock in Electron (same OS process tree),
> so skew is sub-millisecond. No correction needed.

---

## Metric #3 — CPU use during 30s streaming (target < 25% on M-series Mac)

**Where the numbers are:**

- Main terminal every 5s: `[perf.cpu] user=<µs> system=<µs> window=<ms> pct=<%>`
  — single-process CPU %, matching Activity Monitor's per-process view.

**Reading it:** during active streaming you should see 6 `perf.cpu` samples
over 30s. None of them should exceed 25% on an M-series Mac. Cross-check
against Activity Monitor → Electron process.

---

## Metric #4 — React renders per second during burst (target ≤ 60)

**Not instrumented with logs — use React Profiler.**

1. Install React DevTools (you likely already have them).
2. Open DevTools → **⚛ Profiler** tab.
3. Click **Record** (●), submit a streaming prompt, stop recording after
   the first 2 seconds of streaming.
4. Look at the **Ranked** chart. Count commits in the timeline for
   `ChatHistoryView` + its descendants over 1s.

Should stay ≤ 60 commits/s. If you see a single component re-rendering
many more times per batch than expected, check:

- Is it reading from `conversationStore` without `useConversationSelector`?
- Is it missing `React.memo` on the leaf?

---

## Metric #5 — Memory growth during 30-min session (target < 30 MB)

**Where the numbers are:**

- Main terminal every 30s: `[perf.heap] heapUsed=<MB> rss=<MB>`.

**Reading it:** snapshot the first sample, let the app run for 30 minutes
with a few long streams in between, note the final sample. Delta heapUsed
should be < 30 MB.

> ⚠️ `heapUsed` is noisy between GCs. If you see a high reading, wait for
> the next sample (or force a GC via DevTools Memory tab) before trusting
> the number. `rss` is the more stable OS-level figure; it grows due to
> V8 arena reserves too, so expect it to be 30–100 MB over heapUsed.

---

## Turning instrumentation off

Instrumentation is compiled out in production builds automatically:

- **Main** (`event-stream.ts`): gated by `process.env.NODE_ENV !== 'production'`.
- **Renderer** (`conversation-store.ts`, `MessageItem.tsx`): gated by
  Vite's `import.meta.env.DEV` flag.

No flag to toggle — if you want prod-like timing in a dev build, run
`NODE_ENV=production npm run dev`.

---

## Where the instrumentation lives

| File                                                 | What it logs                            |
| ---------------------------------------------------- | --------------------------------------- |
| `src/main/opencode/event-stream.ts`                  | `perf.flush`, `perf.cpu`, `perf.heap`   |
| `src/renderer/src/store/conversation-store.ts`       | `perf.hop`                              |
| `src/renderer/src/components/prompt/MessageItem.tsx` | `perf.first-paint` + `performance.mark` |

All log lines are prefixed `[perf.*]` for easy grepping.
