# OpenCode Hosting Refactor — Architectural Plan

> **Real goal**: Replace the bundled OpenCode Node/WASM bundle with **per-platform
> native binaries** (Mode C). Get there via a clean abstraction stack that lets us:
>
> 1. Validate the multi-process topology TODAY using a forked utility process
>    (Mode B) — no binary build pipeline required.
> 2. Drop in a `child_process.spawn`-based strategy (Mode C) tomorrow with
>    **zero changes** to facade, callers, IPC, or backend code.
> 3. Keep Mode A (in-process) working as a fallback / dev path.
>
> **Status**: Mode B was switched on naively and broke (the runtime tried to
> `utilityProcess.fork()` from inside a utility process). Reverted. Fix is
> structural — the abstraction stack below makes the topology bug
> impossible by construction and makes the binary swap a one-file addition.

---

## Why patterns, and which patterns

The job has three orthogonal axes:

1. **Where the OpenCode HTTP server runs** (in-utility / forked-utility / native-subprocess).
2. **How its lifecycle is controlled** (function call / fork+IPC / spawn+signal).
3. **How callers find its URL** (return value / module read / push event).

Today they're conflated into one function. Splitting them with named patterns
is what makes the binary swap mechanical:

| Pattern                                     | Role                                                                                                                         | Why this pattern                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strategy** (`OpenCodeRuntime`)            | One implementation per hosting kind.                                                                                         | Mode A/B/C have genuinely different control mechanisms. Strategy is the textbook fit when "the algorithm varies".                                                     |
| **Process Supervisor** (`ManagedProcess`)   | Common lifecycle wrapper for any external process: spawn → wait-ready → health probe → graceful stop → force kill → respawn. | Mode B and Mode C are 95% identical at the lifecycle level (start, wait, stop, restart). Extracting the supervisor means Mode C is "just a different `spawn()` call". |
| **Factory** (`createOpenCodeRuntime`)       | Builds a strategy from `OpenCodeRuntimeKind`. The ONLY place modes branch.                                                   | Centralized branching = no scattered `if (kind === ...)` checks.                                                                                                      |
| **Facade** (`OpenCodeServerFacade`)         | Stable public surface (`start/stop/isRunning/getUrl`) for ALL callers.                                                       | Callers (`main/index.ts`, settings handlers, IPC) must be mode-blind. Facade is the textbook fit.                                                                     |
| **Adapter** (main-side, utility-side)       | Implements the facade by talking to the right runtime location: in-main for B/C, RPC-to-utility for A.                       | The facade has one shape; the implementations cross process boundaries. Adapters absorb that.                                                                         |
| **Adapter Selector**                        | Picks the right adapter from `RUNTIME_KIND`.                                                                                 | Single switch point.                                                                                                                                                  |
| **Observer** (`RuntimeUrlSubject`)          | URL discovery as `set/get/subscribe/waitFor`.                                                                                | URL is mutable across restarts, can arrive late, and is consumed by many backend SDK clients. Observer eliminates polling and timing races.                           |
| **Bridge Event** (`opencode.url.set`)       | Wire format for pushing URL changes from main → backend. Transport-neutral name (not "fork", not "spawn").                   | Mode B and C both produce a URL in main; backend always learns it the same way.                                                                                       |
| **Configuration constant** (`RUNTIME_KIND`) | Single switch point at the type level.                                                                                       | Compile-time decision, no runtime config.                                                                                                                             |

The two patterns that pay off most for the binary swap are **Process
Supervisor** and **Strategy**. Once `ManagedProcess` exists, Mode C's
strategy is ~80 lines: build the spawn args, return a `ManagedProcess` that
wraps the child. Health probing, graceful stop, exit handling, restart —
all inherited.

---

## Topology after refactor

### Mode A — `in-process-utility` (today's default)

```
Facade.start(port)
  └─▶ AdapterSelector → UtilityRpcAdapter
       └─▶ Bridge RPC: opencode.server.start
            └─▶ backend utility runs InProcessOpenCodeRuntime
                 └─▶ Server.listen() inside backend utility process
                      └─▶ url written to RuntimeUrlSubject (backend-local)
```

### Mode B — `dedicated-utility` (validation step for the topology)

```
Facade.start(port)
  └─▶ AdapterSelector → MainHostAdapter
       └─▶ MainHostAdapter composes ProcessSupervisor + ForkedUtilityStrategy
            ├─ ForkedUtilityStrategy.spawn() → utilityProcess.fork(opencode-host.thread.mjs)
            ├─ supervisor waits for 'ready' bridge event
            ├─ supervisor probes HTTP /health until 200
            └─ supervisor publishes URL to RuntimeUrlSubject
                 └─▶ pushOpenCodeUrl(url) over Bridge
                      └─▶ entry.ts writes to RuntimeUrlSubject (backend-local)
                           └─▶ all backend SDK clients see the URL
```

### Mode C — `native-subprocess` (the actual goal)

```
Facade.start(port)
  └─▶ AdapterSelector → MainHostAdapter
       └─▶ MainHostAdapter composes ProcessSupervisor + NativeBinaryStrategy
            ├─ NativeBinaryStrategy.spawn() → child_process.spawn('opencode', ['serve', '--port', port])
            ├─ supervisor waits for 'listening on ...' line on stderr (or HTTP probe)
            ├─ supervisor probes HTTP /health until 200
            └─ supervisor publishes URL to RuntimeUrlSubject
                 └─▶ identical from here on
```

**The diff between Mode B and Mode C is one strategy file.** Everything
else — facade, adapter, supervisor, URL plumbing, backend wiring — stays.

---

## File-level layout after refactor

```
src/main/opencode/
├── runtime-mode.ts               # ✅ exists. RUNTIME_KIND constant (single source of truth)
├── server-facade.ts              # NEW. Public API. The only file external callers import.
├── adapter-selector.ts           # NEW. Picks adapter from RUNTIME_KIND.
├── url-subject.ts                # NEW. RuntimeUrlSubject (main-side).
│
├── adapters/
│   ├── types.ts                  # NEW. OpenCodeServerAdapter interface.
│   ├── utility-rpc-adapter.ts    # NEW. Mode A. Wraps existing bridge RPC calls.
│   └── main-host-adapter.ts      # NEW. Mode B/C. Composes ProcessSupervisor + Strategy.
│
└── runtime/
    ├── types.ts                  # MOVED from utility/backend/opencode/runtime.ts
    │                             #   → OpenCodeRuntime, OpenCodeRuntimeKind
    ├── factory.ts                # NEW. createOpenCodeRuntime(kind).
    ├── managed-process.ts        # NEW. ProcessSupervisor pattern. Lifecycle for fork/spawn.
    ├── host-protocol.ts          # MOVED from utility/backend/opencode/host-protocol.ts
    ├── in-process.ts             # MOVED from utility/backend/opencode/runtime-in-process.ts
    ├── strategies/
    │   ├── forked-utility.ts     # NEW. Mode B implementation. Wraps utilityProcess.fork().
    │   └── native-binary.ts      # NEW (stub today, real later). Mode C. Wraps child_process.spawn().
    └── virtual-server.d.ts       # MOVED. Ambient module decl for in-process.ts.

src/main/utility/backend/opencode/
├── opencode-host-entry.ts        # ✅ STAYS. The spawned utility's own entry point.
├── url-subject.ts                # NEW. RuntimeUrlSubject (backend-side mirror).
└── url-bridge-handler.ts         # NEW. Subscribes to opencode.url.set on the bridge.

DELETED:
- src/main/utility/backend/opencode-server.ts          (replaced by server-facade.ts)
- src/main/utility/opencode-server-client.ts           (replaced by utility-rpc-adapter.ts)
- src/main/utility/backend/opencode/runtime-dedicated-utility.ts  (replaced by strategies/forked-utility.ts)
- src/main/utility/backend/opencode/runtime-subprocess.ts          (replaced by strategies/native-binary.ts stub)
```

### Why the moves matter

The current layout puts main-only code (`runtime-dedicated-utility.ts`,
`runtime-subprocess.ts`) under `utility/backend/`. That naming lies — they
import `electron`'s `utilityProcess` or Node's `child_process` and CANNOT
run inside a utility. Anyone editing them assumes wrong context, which is
exactly the bug we just hit.

After the move, `src/main/opencode/runtime/strategies/` is structurally
main-only. If a backend file imports a strategy, the build fails or
crashes immediately at boot. The file system enforces topology.

---

## The two interfaces that anchor everything

### `OpenCodeRuntime` (the strategy interface)

Unchanged from today's draft:

```ts
export interface OpenCodeRuntime {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getUrl(): string | null;
}
```

### `ManagedProcess` (NEW — the process supervisor)

This is the abstraction that makes Mode C cheap. Every out-of-process
strategy (B and C) returns one of these:

```ts
export interface ManagedProcess {
  /** Start the underlying process (fork or spawn). Resolves when the
   *  process is alive AND the URL has been determined. */
  start(): Promise<{ url: string }>;

  /** Stop gracefully (signal-based for binaries, kill() for utilities)
   *  with a configurable timeout before force-kill. */
  stop(timeoutMs?: number): Promise<void>;

  /** Pid of the running process, or null. */
  getPid(): number | null;

  /** Subscribe to lifecycle events. */
  onExit(
    cb: (info: { code: number | null; signal: string | null }) => void,
  ): () => void;
  onLog(cb: (line: string) => void): () => void;
}
```

The `MainHostAdapter` doesn't know whether it's holding a forked utility
or a native binary. It just calls `start()` / `stop()` / subscribes to
`onExit`. That's the whole point.

### `ProcessStrategy` (NEW — the factory inside ManagedProcess)

```ts
export interface ProcessStrategy {
  /** Returns a fully-wired ManagedProcess. Implementation owns spawn details. */
  create(args: {
    port: number;
    userDataPath: string;
    logsDir: string;
  }): ManagedProcess;
}
```

- `ForkedUtilityStrategy` (Mode B) — uses `utilityProcess.fork`, MessagePort init, `onExit` from `child.on('exit')`, `onLog` from inherited stdio.
- `NativeBinaryStrategy` (Mode C) — uses `child_process.spawn` with the resolved binary path for the platform/arch, `onExit` from the child, `onLog` from stderr line buffer, graceful stop via `SIGTERM` → `SIGKILL`.

When Mode C lands, only `native-binary.ts` is new. The supervisor, the
adapter, the facade, and every caller stay identical.

---

## Stage-by-stage execution plan

Eight stages. Stages 1–5 are independent and dispatched as parallel
subagents. Stages 6–7 merge them. Stage 8 is verification.

### Stage 1 — Move runtime files + define core types — _Subagent A_

`git mv` the four files into `src/main/opencode/runtime/` and
`src/main/opencode/runtime/strategies/`. Update all internal imports.
Add `runtime/factory.ts` that branches on `OpenCodeRuntimeKind`. The
factory throws if Mode B/C is requested from a non-main process
(detected via `process.type !== 'browser'`).

**Validation**: type-check passes; no lingering imports to old paths.

### Stage 2 — `ManagedProcess` + supervisor scaffolding — _Subagent B_

Create `src/main/opencode/runtime/managed-process.ts`:

- `ManagedProcess` interface (above).
- `ProcessStrategy` interface.
- A `createManagedProcess(strategy, opts)` helper that wires:
  - graceful stop with timeout → force kill,
  - log forwarding,
  - exit-event observer,
  - HTTP `/health` probe with timeout + interval (used by both B and C to confirm the server is actually listening before resolving `start()`).

This file has NO Mode-B or Mode-C-specific code. It's pure lifecycle
plumbing on the `ProcessStrategy` interface.

**Validation**: unit-test with a fake `ProcessStrategy` (resolves
immediately, never crashes) and a fake `ProcessStrategy` (always crashes).
Confirm `start` rejects on crash and `stop` is idempotent.

### Stage 3 — `ForkedUtilityStrategy` (Mode B) — _Subagent C_

Implement `src/main/opencode/runtime/strategies/forked-utility.ts`. Uses
`utilityProcess.fork`, MessageChannelMain, the existing `host-protocol.ts`
RPCs, and the existing `opencode-host-entry.ts` child. Returns a
`ManagedProcess`-shaped object.

Key requirement: the strategy MUST NOT know about adapters, facades, or
URL subjects. It only owns "spawn this child and tell me when it's
listening on a URL". The supervisor handles the rest.

**Validation**: with `RUNTIME_KIND='dedicated-utility'`, the host child
forks, becomes ready, replies with a URL, and `kill -9 <child-pid>`
triggers `onExit`.

### Stage 4 — `NativeBinaryStrategy` stub (Mode C scaffold) — _Subagent D_

Implement `src/main/opencode/runtime/strategies/native-binary.ts` as a
stub that throws "not yet wired — binary distribution pending" but with
the FULL `ProcessStrategy` shape filled in (commented placeholders for
the spawn line, signal handling, etc). This makes the eventual real
implementation a fill-in-the-blanks job.

Document in the file's header what's needed to enable it:

- per-platform binary path resolution (resources/opencode-bin/<plat>/<arch>/opencode),
- prebuild script to download/copy binaries,
- electron-builder asar-unpack rule for the binary,
- which arg shape the upstream `opencode` CLI accepts (e.g. `serve --port 4096 --host 127.0.0.1`).

This stage is the **commitment** to Mode C — the file exists, the design
is in place, the work to enable it is named and bounded.

### Stage 5 — URL Observer + bridge contract — _Subagent E_

- `src/main/opencode/url-subject.ts` (main-side).
- `src/main/utility/backend/opencode/url-subject.ts` (backend-side mirror).
- `src/main/utility/backend/opencode/url-bridge-handler.ts`.
- Add `pushOpenCodeUrl(url)` to `src/main/utility/supervisor.ts`.

Audit and migrate every existing `getOpenCodeServerUrl()` caller to read
from the subject. Produce the audit list in handoff.

**Validation**: round-trip null → URL → null over a fake bridge; confirm
both subjects converge. Migrated callers compile.

### Stage 6 — Adapters + facade + selector — _main agent_

Now the parallel work merges:

- `src/main/opencode/adapters/types.ts` — `OpenCodeServerAdapter` interface.
- `src/main/opencode/adapters/utility-rpc-adapter.ts` — Mode A. Wraps the existing bridge RPC calls (today's `opencode-server-client.ts` content, repackaged as an adapter).
- `src/main/opencode/adapters/main-host-adapter.ts` — Mode B/C. Composes `createManagedProcess` + factory-selected `ProcessStrategy`. After `start`, writes URL to main-side subject AND pushes via supervisor.
- `src/main/opencode/adapter-selector.ts` — memoized adapter singleton picked by `RUNTIME_KIND`.
- `src/main/opencode/server-facade.ts` — public exports.

Update import paths in:

- `src/main/index.ts`
- `src/main/ipc/handlers/settings-handlers.ts`

Delete:

- `src/main/utility/backend/opencode-server.ts`
- `src/main/utility/opencode-server-client.ts`

### Stage 7 — Backend wiring — _main agent_

- `src/main/utility/entry.ts`:
  - Conditionally register `opencode-server-rpc.ts` handlers ONLY when `RUNTIME_KIND === 'in-process-utility'`.
  - Wire `url-bridge-handler.ts` unconditionally.
- `src/main/utility/backend/opencode-server-rpc.ts`: switch imports to use the new strategy path directly (factory) since `opencode-server.ts` is gone.

### Stage 8 — Verification — _user, manual + automated_

1. `npx tsc -p tsconfig.node.json --noEmit` → clean.
2. `npm test -- --run` → all tests pass.
3. `npm run build` → `out/main/opencode-host.thread.mjs` emitted.
4. Grep `out/main/opencode-utility.thread.mjs` for `utilityProcess.fork`. Must be ABSENT — proves Mode B/C strategies didn't leak into the backend bundle.
5. Mode A smoke test: rebuild + restart, confirm OpenCode reachable on 4096.
6. Flip `RUNTIME_KIND` to `'dedicated-utility'`. Rebuild + restart. Watch for:
   - `[opencode-runtime:dedicated-utility] forking ...`
   - `[opencode-host] Ready at http://127.0.0.1:4096`
   - `[opencode.url.set] propagated url=http://...` (NEW backend-side log)
   - Backend `[health-check] available=true healthy=true`
7. Crash test: `kill -9 <host-pid>`. Main + backend stay alive (proves crash isolation). `onExit` fires; URL subject drops to null.
8. (Mode C dry-run, optional) Flip `RUNTIME_KIND` to `'native-subprocess'`, rebuild, restart. Confirm the stub throws "not yet wired" with a clear message — proves the failure mode of an incomplete Mode C is a clean error, not silent ECONNREFUSED.

---

## Subagent dispatch table

| Stage | Subagent                                                | Independence                                              | Effort |
| ----- | ------------------------------------------------------- | --------------------------------------------------------- | ------ |
| 1     | A — Strategy moves + factory + types                    | independent                                               | 25 min |
| 2     | B — `ManagedProcess` + supervisor scaffolding           | independent (uses only Node + Electron types)             | 30 min |
| 3     | C — `ForkedUtilityStrategy` (Mode B)                    | depends on Stage 2's interface (placeholder import OK)    | 25 min |
| 4     | D — `NativeBinaryStrategy` stub (Mode C scaffold)       | depends on Stage 2's interface (same placeholder pattern) | 15 min |
| 5     | E — URL Observer + bridge contract                      | independent                                               | 25 min |
| 6     | (main agent) — Adapters, facade, selector, import swaps | merge of 1–5                                              | 25 min |
| 7     | (main agent) — Backend wiring                           | merge of 1, 5                                             | 10 min |
| 8     | (user) — manual verification                            | depends on 6+7                                            | —      |

A/B/E run truly parallel. C/D start with placeholder type imports for
the supervisor interface and are rewired at merge time.

---

## Risks & mitigations

| Risk                                                                          | Mitigation                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend SDK clients capture URL at construction and ignore updates            | Audit produced in Stage 5. Clients refactored to read lazily from subject or accept a URL provider.                                                                                                              |
| Mode B and Mode C have subtly different exit-signal semantics                 | `ManagedProcess.onExit` normalizes to `{ code, signal }`. Strategies map their native shapes to this.                                                                                                            |
| Health-probe interval too aggressive → log spam; too slow → boot feels broken | Default `intervalMs=200`, `timeoutMs=15_000`, both configurable per strategy.                                                                                                                                    |
| Mode C binary not signed on macOS → quarantine kills the spawn                | Handled when Mode C is enabled (electron-builder + notarization); not a Mode B blocker.                                                                                                                          |
| `RUNTIME_KIND` divergence between main and backend bundles                    | Single file, both import it. Each side logs `[opencode] active mode = X` at boot so divergence is visible immediately.                                                                                           |
| `getSettingsSnapshot()` race in main-host-adapter                             | Adapter uses `loadSettings()` from `src/main/settings.ts` (sync, available immediately) instead of the backend snapshot.                                                                                         |
| Strategy file imported from backend by accident                               | Two protections: (a) file system layout under `src/main/opencode/runtime/strategies/` is main-only territory, (b) factory throws when Mode B/C is requested from `process.type !== 'browser'`. Defense in depth. |
| Mode C eventually needs platform binary download/copy step                    | Out of scope here. Stage 4's stub names the missing pieces; the implementation work is bounded.                                                                                                                  |

---

## Out of scope for this refactor

- Implementing Mode C's actual binary distribution. The stub names exactly what's needed; that's a separate work item.
- Auto-respawn on host crash. The supervisor exposes `onExit`; restart policy can be added on top.
- Reorganizing the existing `Bridge` class.
- Reducing the OpenCode bundle size (only relevant if we keep Mode A long-term).

---

## Path to Mode C (the actual goal)

Once this refactor lands, enabling Mode C is:

1. Add a prebuild step that downloads/copies the upstream `opencode` binary per platform into `resources/opencode-bin/<plat>/<arch>/`.
2. Add an electron-builder rule to keep the binary unpacked from asar.
3. Fill in `strategies/native-binary.ts` (the stub from Stage 4):
   - resolve the binary path,
   - `child_process.spawn(binPath, ['serve', '--port', port, '--hostname', '127.0.0.1'])`,
   - `onLog` from stderr line buffer (parse the "listening on http://..." line for URL),
   - graceful stop: `SIGTERM` → wait → `SIGKILL`.
4. Flip `RUNTIME_KIND = 'native-subprocess'`. Done.

That's the test of whether the abstraction is right: enabling the real
goal should be a contained, predictable change. The stages above are
designed to make that true.

---

## Investigation outcome — Mode B → Mode B' → Mode C

> Status as of this entry: **Mode C is the production runtime.**
> `RUNTIME_KIND = 'native-subprocess'` in
> [`desktop/src/main/opencode/runtime-mode.ts`](../src/main/opencode/runtime-mode.ts).
> Mode A, Mode B, and Mode B' code paths are kept in-tree as fallbacks
> for one release, then scheduled for removal (see "Lower-priority
> cleanups" below).

### Chronology

| Mode   | Mechanism                                                                         | Outcome                                                                                                         |
| ------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **A**  | OpenCode runs inside the backend utility process (in-process).                    | Works. Kept as dev fallback. Couples OpenCode lifecycle to backend lifecycle.                                   |
| **B**  | `electron.utilityProcess.fork()` of `opencode-host.thread.mjs`.                   | **Failed.** HTTP healthy ~30 s, then ECONNREFUSED on every cross-process loopback connection. Restart loops.    |
| **B'** | Node `child_process.fork()` of the same host entry with `ELECTRON_RUN_AS_NODE=1`. | **Failed identically.** Same ~30 s healthy window, same ECONNREFUSED, same restart loops. Same root cause as B. |
| **C**  | `child_process.spawn()` of the upstream `opencode` native binary.                 | **Stable.** 15+ consecutive health probes, no restarts, `lsof` shows `COMMAND opencode` (not `Electron`).       |

### Failure signature (Mode B and Mode B', identical)

- HTTP server boots and serves traffic for ~30 seconds.
- After ~30 s, every loopback connection from main → child fails with `ECONNREFUSED`.
- The child's own self-probe (loopback inside the same process) keeps succeeding throughout.
- Supervisor restarts the host; the cycle repeats.
- `lsof` shows the LISTEN socket held by `COMMAND Electron` (not `node`, not `opencode`), even under Mode B' where we forked via Node's `child_process.fork`.

### Root cause — binary identity, not env vars

macOS attaches networking constraints (entitlements / sandbox / per-binary policy) to **binary identity**, not to env vars or argv. Two facts combine:

1. When Electron's main process forks (`utilityProcess.fork` for Mode B, `child_process.fork` for Mode B'), the child's `process.execPath` is the **Electron framework binary**, regardless of `ELECTRON_RUN_AS_NODE=1`. `ELECTRON_RUN_AS_NODE` only changes what the binary _runs_; it does not change what the binary _is_ from the kernel's perspective.
2. The Electron framework binary's networking entitlements/sandbox apply to the child. On macOS those constraints break cross-process loopback after a short window (~30 s observed) — even though intra-process loopback continues to work.

Consequence: any "host OpenCode in a forked Node-flavoured Electron child" approach is structurally doomed on macOS. The fix is to run OpenCode under a **different binary identity** entirely — i.e., a real native executable spawned via `child_process.spawn`, which is exactly what Mode C does.

### Why Mode C works

- The spawned process is a standalone Mach-O / ELF / PE binary with its own identity.
- Networking policy attaches to `opencode`, not to `Electron`.
- `lsof` confirms: `COMMAND opencode` holds LISTEN; cross-process loopback from main → child stays healthy indefinitely.
- No ECONNREFUSED post-startup; no restart loops; the supervisor's `/health` probe stays green.

### Verification snapshot (Mode C)

- 15+ consecutive successful `/health` probes with no restarts.
- `lsof -nP -iTCP:<port> -sTCP:LISTEN` → `COMMAND opencode` (binary identity confirmed).
- No `ECONNREFUSED` after the cold-start window.
- Source: [`desktop/src/main/opencode/runtime/strategies/native-binary.ts`](../src/main/opencode/runtime/strategies/native-binary.ts).

---

## Orphan host processes — separate compounding bug

Discovered during the Mode B' investigation. Independent of the binary-identity issue, but it masked Mode B' diagnostics by producing spurious EADDRINUSE failures and "ghost" health responses.

### Symptom

- Parent died abruptly (Ctrl+C in dev, hot-reload restart, crash, `kill -9`).
- Forked host child was **not** killed. macOS reparented it to launchd (`PPID=1`).
- Orphan kept holding the LISTEN socket on the configured port.
- Next spawn attempt failed silently with `EADDRINUSE`, but the stale orphan briefly answered probes — making the new instance look healthy until the orphan died, at which point everything fell over.

### Fix (applied in both fork-based strategies)

- [`desktop/src/main/opencode/runtime/strategies/child-process-fork.ts`](../src/main/opencode/runtime/strategies/child-process-fork.ts)
- [`desktop/src/main/opencode/runtime/strategies/native-binary.ts`](../src/main/opencode/runtime/strategies/native-binary.ts)

Two pieces:

1. **Module-scope `liveHostPids` set + idempotent parent-death hook.**
   - Hooks: `process.on('exit')`, `SIGTERM`, `SIGINT`, `SIGHUP`, `uncaughtException`.
   - On any of those: `SIGKILL` every PID in `liveHostPids`, then re-raise the signal so the parent's exit semantics are preserved.
   - Idempotent so repeat signals don't double-kill or hang the shutdown path.

2. **Pre-spawn orphan sweep.**
   - `sweepOrphansHoldingPort(port)`:
     - Run `lsof -t -nP -iTCP:<port> -sTCP:LISTEN` to enumerate PIDs holding LISTEN on the target port.
     - For each PID: `process.kill(SIGKILL, pid)`.
   - Followed by a **200 ms busy-wait** so the kernel finishes releasing the LISTEN binding before we attempt to bind. Without the wait, the new bind occasionally races and fails with `EADDRINUSE`.

### Loud `Server.listen` error logging

[`desktop/src/main/utility/backend/opencode/opencode-host-entry.ts`](../src/main/utility/backend/opencode/opencode-host-entry.ts)
now logs:

```
[opencode-host] Server.listen FAILED on 127.0.0.1:<port> (code=<errno>)
```

before re-throwing. Originally added for Mode B' diagnostics; retained because it remains useful for any future regression that re-enables a fork-based strategy.

---

## Cold-start fetch race (pre-existing, follow-up)

Symptom across **all** modes (A, B, B', C):

```
[startup-register] status=error error=fetch failed
[opencode-todo] SDK error ... ECONNREFUSED
```

- Fires before the host's `listening on http://...` line is parsed and before the URL subject is non-null.
- Caused by main-process startup code attempting an OpenCode fetch before the URL is published to `RuntimeUrlSubject`.
- **Not** a Mode C regression. Logged as a follow-up.

Suggested fix (out of scope for this refactor): startup callers should `await urlSubject.waitFor()` (or use the existing observer) before issuing their first fetch, instead of racing the listen line.

---

## Production checklist for shipping Mode C

The runtime side is done. To ship Mode C to end users, the following items are required:

### 1. Bundle the upstream `opencode` native binary per platform

Users cannot be expected to have `~/.opencode/bin/opencode` installed. Mirror upstream's own Tauri desktop pattern (binaries committed under `src-tauri/binaries/<platform>-<arch>/`).

- [ ] Add `desktop/scripts/copy-opencode-bin.mjs` that:
  - Fetches the upstream `opencode` release for the current `process.platform` + `process.arch`.
  - Writes it to `desktop/resources/opencode-bin/<platform>-<arch>/opencode[.exe]`.
  - `chmod +x` the result on POSIX.
- [ ] Pin the version in `desktop/resources/opencode-bin/manifest.json` for reproducibility and auditability.
- [ ] Hook the script into `package:mac` / `package:win` / `package:linux` npm scripts. (Note: as of the Mode C commit the previous `copy:opencode-node` step has been removed — only `copy:opencode-bin` ships now. The Mode A JS bundle is no longer packaged; the Mode A path is dormant/reactivation-ready.)
- [ ] Accept the installer-size impact: binary is ~100 MB → installer goes from small-ish to ~120–150 MB. Acceptable for a developer tool.

### 2. electron-builder `asarUnpack` rule

- [ ] Add `resources/opencode-bin/**` to the `asarUnpack` config.
- Reason: the OS loader cannot `exec` a binary from inside an asar archive.

### 3. macOS signing & notarization

- [ ] The embedded `opencode` binary must be signed with the **same Developer ID** as the outer `.app`.
- [ ] The signed binary must be notarized as part of the standard `electron-builder.afterSign` hook flow.
- Without this, Gatekeeper silently blocks the spawn on user machines (failure manifests as Mode C never reaching `listening`).

### 4. `OPENCODE_SERVER_PASSWORD` — DONE

- [x] On startup the upstream binary warns `server is unsecured` if no password is set.
- [x] `NativeBinaryStrategy` generates `randomBytes(32).toString('base64url')` per spawn.
- [x] Password passed to child via env var `OPENCODE_SERVER_PASSWORD`.
- [x] Auth header injected on **all** main-side and utility-side fetches: - SDK clients via `shared/opencode-sdk-cache.ts` (request interceptor, lazy password read per-request). - Raw HTTP probes (`health.ts`, `managed-process.ts probeOnce`) via `auth-header.ts` helper.
- [x] Per-process indirection (`shared/opencode-password-source.ts`): each process registers its own password getter at module load; main and utility have parallel `password-subject.ts` modules that the bridge keeps in sync.
- [x] Strategy publishes the password into the main-side subject **before** returning, so the supervisor's first readiness probe carries auth and doesn't 401-loop the binary into a force-kill.
- [x] Live-verified: `[opencode-adapter:main-host] ready at http://127.0.0.1:4096 (auth=enabled)`.

#### Audit gap closed (2026-04-25)

After Mode C went live, two modules were found bypassing the shared SDK cache by calling `createOpencodeClient` directly with a private factory + test seam:

- [`question-list.ts`](../src/main/utility/backend/question-list.ts) — `replyToOpenCodeQuestion` / `rejectOpenCodeQuestion` / `fetchPendingQuestions`. **Caused all `request_user_input` Submit clicks to silently no-op** because the reply POST returned 401 Unauthorized.
- [`permission-reply.ts`](../src/main/utility/backend/permission-reply.ts) — `replyToOpenCodePermission`. Would have failed the same way on permission accept/reject prompts.

Both files now route through `getClient()` (re-exported from `sdk-client.ts` → `shared/opencode-sdk-cache.ts`). The unused `_setQuestionClientFactory` / `_setPermissionClientFactory` test seams were removed (no callers).

**Lesson for future work**: any new module that talks to the OpenCode HTTP server MUST use `getClient()` from the shared cache. Do NOT call `createOpencodeClient` directly outside `shared/opencode-sdk-cache.ts`. A grep audit is part of the Mode C verification checklist now.

### 5. Licensing / attribution

- [ ] Confirm OpenCode's MIT license terms and any binary-redistribution clauses.
- [ ] Add NOTICE / attribution to the about screen.

### 6. Strategy resolution order (already implemented)

Defined in [`desktop/src/main/opencode/runtime/strategies/native-binary.ts`](../src/main/opencode/runtime/strategies/native-binary.ts):

| #   | Source                                                                      | Purpose                                                 |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `$OPENCODE_BIN` env var                                                     | Dev/CI override.                                        |
| 2   | Packaged sidecar: `<resourcesPath>/opencode-bin/<platform>-<arch>/opencode` | Production path (after step 1 of this checklist lands). |
| 3   | Dev sidecar: `desktop/resources/opencode-bin/<platform>-<arch>/opencode`    | Dev path after the copy script runs.                    |
| 4   | Dev fallback: `~/.opencode/bin/opencode`                                    | Pre-checklist developer convenience.                    |

Once step 1 of this checklist (the copy script) is wired, dev runs hit the dev sidecar (#3) and stop relying on the user's globally installed binary (#4).

---

## Lower-priority cleanups

### 7. Dead code — remove after one release

The following are unused on the Mode C happy path. Keep one release as a fallback so reverting `RUNTIME_KIND` is a one-line change; then delete.

- [`desktop/src/main/opencode/runtime/strategies/forked-utility.ts`](../src/main/opencode/runtime/strategies/forked-utility.ts) — Mode B strategy.
- [`desktop/src/main/opencode/runtime/strategies/child-process-fork.ts`](../src/main/opencode/runtime/strategies/child-process-fork.ts) — Mode B' strategy.
- `NodeIpcPortShim` — fork-IPC ↔ MessagePort shim (only used by Mode B').
- [`desktop/src/main/utility/backend/opencode/opencode-host-entry.ts`](../src/main/utility/backend/opencode/opencode-host-entry.ts) — host entry (only used by B and B').
- The `opencode-host.thread.mjs` build target — only consumed by the fork strategies.

### 8. Cold-start fetch race

See "Cold-start fetch race" section above. Pre-existing across all modes; needs an `await urlSubject.waitFor()` (or equivalent) on the first fetch path.

---

## Source-file map (for future readers)

| File                                                                                                                                  | Role                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`desktop/src/main/opencode/runtime-mode.ts`](../src/main/opencode/runtime-mode.ts)                                                   | `RUNTIME_KIND` switch — single source of truth for active mode.    |
| [`desktop/src/main/opencode/runtime/strategies/native-binary.ts`](../src/main/opencode/runtime/strategies/native-binary.ts)           | **Mode C** strategy. Active on the happy path.                     |
| [`desktop/src/main/opencode/runtime/strategies/child-process-fork.ts`](../src/main/opencode/runtime/strategies/child-process-fork.ts) | Mode B' strategy. Kept as fallback; scheduled for removal.         |
| [`desktop/src/main/opencode/runtime/strategies/forked-utility.ts`](../src/main/opencode/runtime/strategies/forked-utility.ts)         | Mode B strategy. Kept as fallback; scheduled for removal.          |
| [`desktop/src/main/opencode/adapters/main-host-adapter.ts`](../src/main/opencode/adapters/main-host-adapter.ts)                       | Composes the active strategy + the supervisor.                     |
| [`desktop/src/main/opencode/adapters/selector.ts`](../src/main/opencode/adapters/selector.ts)                                         | Picks the adapter from `RUNTIME_KIND`.                             |
| [`desktop/src/main/opencode/runtime/managed-process.ts`](../src/main/opencode/runtime/managed-process.ts)                             | Transport-agnostic supervisor (lifecycle, health probe, restart).  |
| [`desktop/src/main/utility/backend/opencode/opencode-host-entry.ts`](../src/main/utility/backend/opencode/opencode-host-entry.ts)     | Host entry for B/B' fork strategies (carries the loud-listen log). |
