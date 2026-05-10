# Backend Utility-Process Extraction — Design & Plan

**Status:** Phases 0–4 complete. Phase 5 (cleanup + docs) is the current pass.
**Update:** the OpenCode HTTP server has since moved to **Mode C — `native-subprocess`** (see [ARCHITECTURE.md](./ARCHITECTURE.md#opencode-server-runs-as-a-native-subprocess-mode-c--committed-default)). References below to `virtual:opencode-server` and "OpenCode in-process server" describe the previous Mode A topology and are preserved for historical context; the in-process import path is dormant/reactivation-ready and no longer the active build flow.
**Owner:** TBD
**Target branches:** feature/backend-utility-process
**Related docs:** [ARCHITECTURE.md](./ARCHITECTURE.md), [MCP-SERVER.md](./MCP-SERVER.md), [OPENCODE-EVENTS.md](./OPENCODE-EVENTS.md), [IPC-API.md](./IPC-API.md), [BACKEND-OPENCODE-SIDECAR-RESEARCH.md](./BACKEND-OPENCODE-SIDECAR-RESEARCH.md)

## 0. Architectural context — why `utilityProcess` and not a sidecar binary

Before landing on this plan we studied how OpenCode's own Tauri desktop app (`~/Desktop/opencode/packages/desktop`) solves the same "backend coupled to UI event loop" problem. Their answer: **ship `opencode serve` as an external sidecar binary**, spawn it as a child process, talk to it over localhost HTTP + Basic Auth. Full notes in [BACKEND-OPENCODE-SIDECAR-RESEARCH.md](./BACKEND-OPENCODE-SIDECAR-RESEARCH.md).

We considered three options:

- **A. `utilityProcess`** — extract OpenCode + MCP + SSE into an Electron utility child. All data stays in Node; MessagePort for renderer forwarding.
- **B. Sidecar binary** — package OpenCode CLI, spawn it, HTTP to it. Main becomes a thin client. Matches Tauri.
- **C. Hybrid** — sidecar OpenCode binary _and_ a utility process for our MCP/DB/prompts.

We chose **A** for now because:

1. Our MCP tools reach into OpenCode SDK internals (`opencode/sdk-client.ts`, `opencode/provider.ts`, session-tree integrations). Replacing those with OpenCode's _public_ HTTP API is a separate, larger refactor.
2. `utilityProcess` keeps the existing import graph intact — the move is mostly mechanical.
3. Fastest path to the user-visible win (Phase 2 alone puts SSE out of main).
4. Bundle-size win: no second ~100MB CLI binary shipped alongside Electron.

**Long-term exit:** after Phase 4, if the CLI's public HTTP API becomes a superset of what our MCP tools need, we retire `virtual:opencode-server` and move to Option C. The utility process becomes the MCP-only host; OpenCode itself runs as a sidecar. See §11 below.

---

## 1. Problem

The in-process architecture couples **backend responsiveness to the main-process event loop**. Three subsystems all run inside the Electron main Node runtime:

1. **OpenCode in-process HTTP server** — `desktop/src/main/opencode/server.ts:50` (via `mod.Server.listen(...)` at `:87`).
2. **MCP Express server** — `desktop/src/main/mcp-server.ts:63` (via `app.listen(port)` at `:630`).
3. **SSE event stream** — `desktop/src/main/opencode/event-stream.ts:526`.

When main is busy (heavy tool execution such as Edit + LSP, big diff parsing, indexing passes, synchronous sqlite queries under load), all three subsystems share that event loop. During a blocking window:

- The OpenCode HTTP server cannot answer the renderer's `check-opencode-health` probe → the UI health indicator flips to `connecting…` even though nothing has actually disconnected.
- The SSE pump falls behind; conversation updates lag or time out.
- Tool handlers that depend on prompts/IPC look "stuck" from the renderer's perspective.

Symptom is identical in dev and production — it is **not** caused by electron-vite HMR. (electron-vite only restarts main if `build.watch` is set, which this repo does not set.)

The comment at `opencode/server.ts:2-10` notes this subsystem "replaces the old subprocess spawn model" — the move to in-process was deliberate, but it made every CPU-heavy main-process task visible to end users as a fake backend disconnect.

## 2. Goal

Move the three subsystems into a single Electron **`utilityProcess`** child owned by main, communicating via **MessagePort**. Backend work runs on its own Node event loop; main's UI/IPC glue stays snappy under load. Both dev and production use the same code path — no divergence between environments.

Secondary win: a crash inside the backend (e.g. an OpenCode bundle throw) no longer takes down the UI; main respawns the utility with backoff.

> **A note on HMR:** `utilityProcess.fork()` creates a child of main, so if main itself were ever restarted by a future HMR setup, the utility would die with it. That is acceptable here because today's dev setup does not restart main at all; the extraction targets event-loop isolation, not process-lifecycle survival.

### Non-goals

- Splitting each subsystem into its own process (over-engineering; they share the DB, SDK client, and settings snapshot).
- Reintroducing a detached OpenCode binary or external TCP-based subprocess.
- Renderer-visible API changes. The renderer's `window.api.*` surface stays identical. This is a pure internals move.

## 3. Target architecture

```
┌───────────────────────────── main process ─────────────────────────────┐
│  BrowserWindow / Tray / app / dialog / shell                            │
│  Settings file IO (owns path; broadcasts snapshots)                     │
│  Supervisor loop, providers-refresh timer                               │
│  ipcMain.handle(...) — all renderer entry points                        │
│  Forwards utility events → webContents.send                             │
│  Forwards renderer 'prompt-response' → utility                          │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ MessagePort (structured clone)
┌──────────────────────────────┴─────────────── utility process ─────────┐
│  OpenCode in-process server (virtual:opencode-server)                   │
│  MCP Express server + StreamableHTTPServerTransport + tools             │
│  Durable prompt store                                                   │
│  SSE event-stream + coalescer + prompt-event-forwarder                  │
│  session-tree-service, sse-handlers, resolver, auto-register            │
│  SDK client cache                                                       │
│  SQLite (better-sqlite3) — conversations.db                             │
│  attachment-store, session/file.ts                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

All three subsystems share the DB, the SDK client, and the settings snapshot — co-locating them in one utility process avoids an extra IPC hop per SSE batch and per tool call.

## 4. Decisions

| Decision         | Choice                                                              | Rationale                                                                                                                 |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Extraction scope | OpenCode server + MCP server + SSE event-stream + session-tree + DB | Shared DB/SDK cache; splitting would force per-event IPC on hot paths.                                                    |
| Transport        | Electron `utilityProcess.fork()` + `MessagePortMain`                | Native Electron API, structured clone, survives main restarts cleanly, no localhost port conflicts.                       |
| Environments     | Dev **and** production                                              | Avoids "works in dev, breaks in prod" divergence. Same code path everywhere.                                              |
| DB location      | Moves with utility process                                          | DB is hottest on MCP tool + SSE paths. Main-side IPC handlers that read the DB will proxy through the utility.            |
| Bundle strategy  | Second rollup input in electron-vite `main` config                  | Reuses existing multi-entry pattern (`context-injector-worker.thread`). Keeps virtual-module + wasm-copy plugins working. |

## 5. Things that cannot move as-is (refactor required)

| #   | Item                                                          | File:Line                                                                                                                                                                                                                                                   | Required refactor                                                                                                                                           |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `app.getPath('userData')` in `prepareServerEnv()`             | `opencode/server.ts:157`                                                                                                                                                                                                                                    | Pass `userDataPath` into utility at spawn via `env` or init message.                                                                                        |
| 2   | `settings.ts` imports `electron.app`                          | `settings.ts` (top)                                                                                                                                                                                                                                         | Split into pure schema/defaults/merge module + main-side path wrapper. Utility receives settings snapshots over MessagePort.                                |
| 3   | `database.ts` imports `electron.app`                          | `database.ts:4,341`                                                                                                                                                                                                                                         | Pass DB path in at init. `better-sqlite3` itself works in utility processes.                                                                                |
| 4   | `webContents.send(...)` call sites (renderer-bound events)    | `mcp-server.ts:179,182,251,254,595`, `mcp-server/auto-register.ts:164`, `mcp-server/server-factory.ts:97`, `session/session-tree-service.ts:139`, `event-stream.ts:197`, `prompt-event-forwarder.ts:245`, `tools/manage-skills-and-instructions.ts:200,351` | All become `port.postMessage({ type: 'forward-to-renderer', channel, payload })`. Main fans out to `webContents`.                                           |
| 5   | `ipcMain.on('prompt-response', ...)`                          | `ipc/prompt.ts:201`                                                                                                                                                                                                                                         | Main receives the IPC, forwards message to utility over MessagePort.                                                                                        |
| 6   | `virtual:opencode-server` dynamic import                      | `opencode/server.ts:70`, `electron.vite.config.ts:110-119`                                                                                                                                                                                                  | Add a second rollup input (e.g. `opencode-utility.thread.ts`) in the `main` config. Verify `.wasm` sibling resolution still works (emits into `out/main/`). |
| 7   | `better-sqlite3` native bindings in packaged builds           | electron-builder config                                                                                                                                                                                                                                     | Ensure native module is unpacked and resolvable from the utility-process entry.                                                                             |
| 8   | `BrowserWindow` / `Tray` handles captured by MCP start params | `mcp-server.ts:53-61` (`_startParams.getWindow`)                                                                                                                                                                                                            | Replace `getWindow` with an opaque "emitToRenderer" function that posts to the port.                                                                        |

## 6. Minimum IPC surface (main ↔ utility over MessagePort)

### 6.1 Lifecycle requests (main → utility, await reply)

- `start-opencode-server({ port })`
- `stop-opencode-server()`
- `is-opencode-running()`
- `start-mcp-server({ port, settingsSnapshot })`
- `stop-mcp-server()`
- `soft-restart-mcp()`
- `restart-mcp()`
- `close-mcp-session({ connectionId })`
- `start-event-stream({ port })`
- `stop-event-stream()`

### 6.2 Health (main → utility)

- `probe-health()` → `{ opencode: {...}, mcp: { activeClients } }` — replaces the supervisor's current direct calls to `checkOpenCodeHealth()` + `getActiveMcpSessionCount()`.

### 6.3 Fire-and-forget (main → utility)

- `settings-updated(snapshot)` — broadcast on every `saveSettings()` / `settings-changed`. Utility caches locally; replaces all in-subsystem `loadSettings()` calls.
- `prompt-response({ id, answer, attachments? })` — main forwards the renderer's `prompt-response` IPC here.

### 6.4 Utility → main (forwarded to renderer)

Main receives these and calls `mainWindow.webContents.send(channel, payload)`:

- `prompt-request`, `prompt-clear`
- `connection-opened`, `connection-closed`
- `session-channel-created`, `session-channel-deleted`, `session-channel-messages-cleared`
- `channel-label-updated`
- `session-tree-invalidated`
- `conversation-batch` (hot path, 16ms cadence — must not re-serialize)
- `permission-asked`, `permission-replied`, `question-asked`, `question-cleared`
- `providers-info:updated`
- `skills-updated`

### 6.5 DB proxy (utility ↔ main for renderer-driven DB calls)

IPC handlers currently in main that read/write the DB directly (`skills-handlers`, `session-channel-handlers`, `context-tracking-handlers`, `conversation-handlers`, etc.) proxy through the utility via a generic `db-call({ fn, args })` message, or via explicit per-function requests. These are low-frequency (human-driven UI actions), so latency is not a concern.

## 7. Migration plan (phased, with rollback points)

Each phase ends green (all tests pass, app boots) so we can stop at any checkpoint.

### Phase 0 — Prep (no behavior change)

- [ ] Extract pure helpers from each subsystem where they are currently coupled to Electron (`settings.ts`, `database.ts`). Tests added for the pure modules.
- [ ] Land a `createLogger('utility')` scope.
- [ ] **Checkpoint:** `npm test -- --run` green (all 427+), `npm run check-types` green.

### Phase 1 — Messaging scaffolding

- [ ] Add `desktop/src/main/utility/bridge.ts` — typed wrapper over `MessagePortMain` with request/reply, event, and error semantics.
- [ ] Add `desktop/src/main/utility/entry.ts` — utility-process entry (currently a no-op bootstrap).
- [ ] Add second rollup input in `electron.vite.config.ts` main config (mirroring `context-injector-worker.thread`).
- [ ] Wire `utilityProcess.fork(path.join(__dirname, 'opencode-utility.thread.mjs'))` from main in dev-and-prod, log `[utility] started`.
- [ ] Send one ping/pong over the port to prove the transport.
- [ ] **Checkpoint:** dev build boots, utility child visible in process list, logs ping.

### Phase 2 — Move SSE event-stream first (lowest coupling)

- [x] Move `opencode/event-stream.ts`, `event-coalesce.ts`, `event-bridge.ts`, `prompt-event-forwarder.ts` into the utility (`desktop/src/main/utility/backend/`).
- [x] `webContents.send('conversation-batch', ...)` → `bridge.emit('to-renderer', { channel, payload })`; main supervisor forwards to focused `BrowserWindow`.
- [x] DB lookups (`get-registered-connection`) executed via `bridge.request(...)` back to main (utility cannot load `better-sqlite3` yet).
- [x] Context-tracking (`setModelContextLimit`, `fetchSessionTokens`, `setSessionTotalTokens`, `triggerCompaction`) moved into utility with bridge RPC/emit from main-side callers (`provider.ts`, `ipc/handlers/context-tracking-handlers.ts`).
- [x] Permission reply (`reply-permission`) invoked from renderer → main IPC → `bridge.request` → utility executes `replyToOpenCodePermission`.
- [x] Settings mirror: main emits `settings-updated` envelope on save; utility maintains in-memory snapshot (`settings-mirror.ts`).
- [x] Supervisor + renderer `check-opencode-health` unchanged (they use HTTP, not SSE).
- [x] Validation: `tsc -p desktop/tsconfig.node.json --noEmit` clean; `npm run check-types` clean; `electron-vite build` emits `opencode-utility.thread.mjs`.
- [ ] **Checkpoint:** SSE events flow to renderer identically. HMR edits to **main-only** files no longer restart SSE. _(Manual verification pending — requires running the app.)_

### Phase 3 — Move OpenCode server + session-tree + DB

- [x] Moved `opencode/server.ts`, `opencode/sdk-client.ts`, `opencode/provider.ts`,
      `opencode/config-sync.ts`, `opencode/mcp-register.ts`, `opencode/session.ts`,
      and related SDK wrappers into `utility/backend/opencode/**`.
- [x] Moved `session/*` (session-tree-service, sse-handlers, resolver, auto-register,
      file) into `utility/backend/session/**`. `session/resolver.ts` is now **async** —
      all callers in `tools/**`, IPC handlers, and prompt routing await it.
- [x] Moved `database.ts` into `utility/backend/`; `userDataPath` injected from main
      via the init envelope.
- [x] Packaging: `asarUnpack: ["node_modules/better-sqlite3/**/*"]` added to
      `desktop/package.json`'s `build` config so the native binding resolves outside
      asar. `postinstall` still runs `electron-rebuild -w better-sqlite3`.
- [x] `opencode/health.ts` stays in main — plain HTTP GET used by the watchdog timer
      (`openCodeSupervisorTimer`, `openCodeConsecutiveFailures`,
      `openCodeRestartInFlight`). Watchdog restart now calls
      `bridge.request('opencode.server.start|stop')` instead of a direct import.
- [x] Main-side IPC handlers that touched the DB converted to thin
      `bridge.request('db.<fn>', args)` proxies via `utility/db-client.ts`.
      No main-side cache for `registered_connections` — every read is an RPC (rejected
      as overengineering during planning).
- [x] `providers-info` update path is now
      `bridge.emit('to-renderer', { channel: 'providers-info', payload })` from the
      utility (emitted by `opencode/provider.ts` in-utility).
- [x] **Checkpoint:** DB-backed tests run against utility-side DB; typecheck green.

### Phase 4 — Move MCP server + prompt store + tools

- [x] **Phase 4a:** Moved `mcp-server.ts`, `mcp-server/*`, and `tools/*` into
      `utility/backend/`. Tool registration (`registerRequestUserInput`,
      `registerIntensiveChatTools`, `registerSessionChannelTools`, `registerSendMessageTool`,
      `registerConnectionTool`, `registerFindRepoDocsTool`,
      `registerManageSkillsAndInstructionsTool`, `registerPollContextInjectionsTool`)
      happens in-utility.
- [x] **Phase 4a:** MCP API router updated to receive `closeSessionByConnectionId` via
      dependency injection (previously a direct import). Lifecycle exposed as
      `mcp.server.<start|stop|softRestart|restart|closeSessionByConnectionId|activeSessionCount>`
      plus the fire-and-forget event `mcp.server.markSessionDeleted`.
- [x] **Phase 4b:** Moved `ipc/prompt.ts` (durable prompt store) into the utility.
      `ipcMain.on('prompt-response', ...)` in main forwards to the utility via
      `bridge.request('reply-permission', ...)` / the durable-prompt response flow.
      `reconnect-mcp-server` / `restart-mcp-server` / `force-terminate-chat` /
      `dismiss-session` IPC handlers are now thin bridge proxies
      (`utility/mcp-server-client.ts`).
- [x] Shared mapping: extracted `mapMessage` / `mapPart` into
      `src/shared/opencode-mapping.ts` so main's `conversation-handlers.ts` and the
      utility's `event-bridge.ts` stay semantically in sync.
- [x] Attachment cleanup timer + file IO confirmed working from the utility.
- [x] **Checkpoint:** Full test suite green against utility-hosted MCP. Prompts,
      intensive chat, tools, soft-restart verified.

### Phase 5 — Clean up & docs (in progress)

- [ ] Remove dead main-side imports.
- [x] Update `ARCHITECTURE.md`, `MCP-SERVER.md`, `OPENCODE-EVENTS.md`, `IPC-API.md`,
      `BUILD-PACKAGING.md`, `SETTINGS-CONFIG.md` to reflect the main/utility boundary.
- [ ] Add a `KNOWN-ISSUES.md` entry if any edge case remains (e.g., startup ordering).
- [x] Update this plan's status header.

## 8. Risks & mitigations

| Risk                                                                                 | Mitigation                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `virtual:opencode-server` bundle resolution breaks on second rollup entry            | Verify early in Phase 1 by building once with a stub utility that imports it. Keep `.wasm` emission in `out/main/`.                                               |
| `better-sqlite3` fails to load in utility in packaged build                          | Verify packaging in Phase 3 with a real `npm run package:mac` before advancing.                                                                                   |
| `conversation-batch` latency regresses due to double hop (utility → main → renderer) | Measure p50/p99 in Phase 2 against baseline. If regressed, investigate `MessagePortMain.postMessage` with `Transferable` arrays or batch at the utility boundary. |
| Supervisor races with utility startup                                                | Supervisor waits for the utility's `ready` event before the first probe. Keep existing 30s cold-start budget.                                                     |
| Settings stale in utility after user change                                          | `settings-updated` broadcast is synchronous from the renderer IPC path; utility caches the latest snapshot atomically.                                            |
| Utility crashes (e.g., OpenCode bundle throw) take down backend                      | Main listens for `utility.on('exit', ...)` and respawns with exponential backoff. Log every crash prominently. Phase 1 lands the supervisor loop.                 |
| HMR in dev restarts main → utility is orphaned                                       | Main's `before-quit` sends `stop` to utility and awaits exit. On respawn, utility is forked fresh. Acceptable for dev; prod uninterrupted.                        |

## 9. Acceptance criteria

1. Editing **any** main-process file during `npm run dev` no longer produces `Health check failed` or `SSE stream ended normally — reconnecting` logs from pre-existing sessions (the utility process survives).
2. `npm test -- --run` in `desktop/` passes all 427+ tests.
3. `npm run build` and `npm run package:mac` succeed.
4. No change to renderer `window.api.*` surface.
5. Conversation-batch p99 latency within 5% of baseline.
6. Manual smoke: new session → prompt → tool call → intensive chat → soft-restart → force-terminate all succeed.

## 10. Decisions resolved

1. **Supervisor stays in main.** Main owns the utility-process restart/backoff loop. If the utility itself crashes, main respawns it with exponential backoff.
2. **Explicit per-function RPC** between main IPC handlers and the utility DB. Keeps typings and telemetry clean.
3. **Providers-info subscriber moves into the utility** alongside the OpenCode HTTP client. Main receives `providers-info:updated` events over the port and forwards to the renderer.
4. **Burn the boats.** Once extracted, the utility path is the only path. No `NO_UTILITY_PROCESS` fallback flag.

## 11. Patterns lifted from OpenCode's Tauri app

Even though we are not going sidecar today, these patterns apply directly to our `utilityProcess` path. They come from `~/Desktop/opencode/packages/desktop/src-tauri`. Full context: [BACKEND-OPENCODE-SIDECAR-RESEARCH.md](./BACKEND-OPENCODE-SIDECAR-RESEARCH.md).

| #   | Pattern                                                      | Where to apply in our plan                                                                                                                                              |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Resolve "ready" credentials **before** health check          | Utility should post a `ready` message with `{port, ok}` as soon as it's listening, before the first HTTP probe. Main unblocks `check-opencode-health` on that. Phase 1. |
| 2   | Race "ready" vs "terminated" on startup                      | Supervisor does `Promise.race([readyMessage, exitEvent])`. Fail-fast on crashed startup instead of waiting 30s. Phase 1.                                                |
| 3   | Pass init config via first message, **not** env vars         | Main sends `{ userDataPath, settingsSnapshot, dbPath, mcpPort }` as the first MessagePort message. Env vars cannot be updated without respawn. Phase 1.                 |
| 4   | `RunEvent::Exit` → kill child                                | `app.on('before-quit')` + `app.on('will-quit')` must post `stop` to utility and await `exit` before the event loop terminates. Phase 1.                                 |
| 5   | Free-port via `bind(:0)` if we ever expose HTTP from utility | Not needed today (MessagePort is the transport). Keep in back pocket for Option C.                                                                                      |
| 6   | `no_proxy` for loopback documented                           | If we ever use HTTP between main and utility (Option C), `HTTP_PROXY=...` with no loopback exclusion breaks it. Add to `KNOWN-ISSUES.md` then.                          |
| 7   | Login-shell env inheritance                                  | If we sidecar OpenCode later, launch via `bash -lc` / `zsh -lc` on POSIX so `PATH`/Homebrew/`OPENCODE_*` env vars flow through.                                         |
| 8   | Loading window for slow SQLite migrations                    | Our DB is already seeded, but if migrations ever get slow, stream progress events to the renderer via the existing `session-tree-invalidated` bus.                      |

## 12. Migration exit to Option C (post-Phase 4)

Once Phase 4 ships, evaluate:

- Does OpenCode's public HTTP API (`/session/*`, `/event`, `/provider`, `/file/*`, `/global/*`) expose everything our MCP tools currently call via `sdk-client.ts`?
- If yes, replace in-process `virtual:opencode-server` imports with an HTTP client talking to a spawned `opencode serve` sidecar binary.
- Utility process becomes MCP-only (plus DB, prompts, tools).
- Main stays a thin router.

Gating this on Phase 4 completion means we don't block today's user-visible fix on a large SDK-to-HTTP refactor. If the answer is "no, we need private SDK access," we stay on the `utilityProcess` architecture indefinitely.
