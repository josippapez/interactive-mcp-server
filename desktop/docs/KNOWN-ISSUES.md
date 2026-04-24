# Known Issues

---

## 1. `request_user_input` hangs after app restart (Cmd+Q → relaunch)

### Symptom

After the Desktop app is fully quit (Cmd+Q) and relaunched, calling `request_user_input` (or any MCP tool) causes the call to hang indefinitely. The Desktop UI never shows a prompt. Checking `GET /health` reveals `activeClients: 0` — the MCP session was never established after restart. The hang persists until the user manually calls `register_connection`, which forces a fresh MCP handshake.

### Root cause

After a full quit + relaunch, OpenCode's `type: "remote"` MCP client (Streamable HTTP) holds a **stale connection state** pointing to the previous server instance. It will attempt to reconnect using exponential backoff — the initial retry may take tens of seconds, and intermediate retries may silently fail. During this backoff window, any tool call from the agent is queued inside OpenCode's MCP client and never dispatched to the HTTP server.

The Desktop app previously did not notify OpenCode about the restart. Without an explicit re-registration, OpenCode's client has no signal to abandon its stale session and reinitialize immediately.

**Why `register_connection` was the workaround**: calling it triggers `handleTransparentReinit`, which performs a fresh `initialize` handshake and returns a new `Mcp-Session-Id`. This gives OpenCode's client a live session, unblocking all queued tool calls.

### Fix (implemented)

On every app startup (when `agentBackend === 'opencode'`), the app calls `registerMcpWithRetry` in the background. This POSTs to OpenCode's `/mcp` API (`http://localhost:{openCodePort}/mcp`), registering the Desktop as a remote MCP server and prompting OpenCode to perform a fresh `initialize` handshake immediately — rather than waiting for its own backoff to expire.

The call is fire-and-forget with retries, so it handles the case where OpenCode is not yet running when the Desktop app launches.

**Changed file**: `src/main/index.ts` — added `registerMcpWithRetry` call in the `isOpenCodeBackend` startup block (after `reconcileSessionConnections`).

### Secondary issue: dead SSE stream while prompt is active

A separate (less common) scenario: the app is backgrounded long enough for the OS to kill its idle TCP connections while a prompt is actively waiting. In this case, `activeClients > 0` but the tool result can never be delivered because the SSE GET stream's TCP socket is dead.

**Fix (previously implemented)**: SSE keepalive heartbeat (15s `": keepalive\n\n"` comments on `GET /mcp`) + socket `close`/`error` listener that calls `cancelActivePrompt` when the SSE stream dies. Implemented in `src/main/mcp-server.ts` GET /mcp handler.

> **Update (durable prompt rewrite):** The root problem — an HTTP connection drop killing the in-flight tool call and resolving `promptUser()` with a `-32000 Connection closed` error — is now solved by the **durable prompt system** in `ipc-prompt.ts`. Each active prompt is backed by a `DurablePromptState` held in main-process memory, independent of the HTTP transport. When the MCP `AbortSignal` fires mid-wait (TCP drop), the durable promise is **not** resolved; it keeps waiting. When the agent retries (transparent session resurrection), the new `promptUser()` call detects the existing live state and attaches to the same durable promise — no second UI prompt is spawned. The SSE keepalive heartbeat is still useful for maintaining server-initiated message delivery, but it is no longer required to keep tool calls alive during long user-think times.

### Affected code paths

| File                                | Relevant location                                     | Notes                                                                             |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/main/index.ts`                 | `registerMcpWithRetry` call (line ~97, startup block) | Fix: re-registers on every startup so OpenCode reconnects immediately             |
| `src/main/opencode-mcp-register.ts` | `registerMcpWithRetry` / `registerMcpWithOpenCode`    | Posts to OpenCode's `/mcp` API to tell it to reinitialize the MCP connection      |
| `src/main/mcp-server.ts`            | `GET /mcp` handler (~line 654)                        | SSE keepalive + dead-stream detection (secondary fix)                             |
| `src/main/mcp-server.ts`            | `handleTransparentReinit`                             | Used by `register_connection` tool; still the fallback if auto-registration fails |

---

## 2. macOS unsigned-dev launch-at-login error (`platform_util_mac.mm:260`)

### Symptom

Running the app in dev mode (`npm run dev`) on macOS previously produced a native-log line:

```
[ERROR:platform_util_mac.mm:260] Operation not permitted
```

on startup and again on every `save-settings` IPC call. The error was emitted by Chromium's `app.setLoginItemSettings()` wrapper and bypassed any JS-level try/catch.

### Root cause

macOS refuses the `SMLoginItemSetEnabled` call for unsigned binaries. Because the failure is logged inside native code before control returns to JS, wrapping the call in try/catch does not suppress it.

### Fix (implemented)

Both call sites now guard the call on `app.isPackaged`:

- `desktop/src/main/index.ts:271` — startup call inside `runDeferredInit`.
- `desktop/src/main/ipc/handlers/settings-handlers.ts:26` — on every settings save.

In dev (unpackaged) builds the call is simply skipped; in packaged/signed builds it runs as before so launch-at-login still works in production.

No user action required.

---

## 3. Wasm copy layout sensitivity

The `opencode:copy-server-assets` plugin in `electron.vite.config.ts` copies `tree-sitter-*.wasm` into `out/main/` — **not** `out/main/chunks/`. The OpenCode Node bundle resolves wasm files via `new URL('tree-sitter.wasm', import.meta.url)`, which is relative to the chunk's own path.

Our current Rollup config keeps the main-process chunk at the default location (`out/main/`), so the wasm files have to land there. Upstream `packages/desktop-electron` emits the chunk under `out/main/chunks/` and copies the wasm files there instead.

**If the chunk layout ever changes** (e.g. chunks are moved under `out/main/chunks/`), the copy target in the plugin must move with it. Otherwise the OpenCode server will fail at runtime when it tries to load tree-sitter grammars.

No user-facing symptom yet — documented here so the next engineer to touch rollup output options does not silently regress wasm loading.

---

## 4. Legacy `copy:opencode*` still wired into packaging

The Phase C migration replaced the spawned `opencode serve` subprocess with an in-process `Server.listen()` call (see `desktop/src/main/opencode/server.ts:46`), but the packaging scripts in `desktop/package.json` still chain `copy:opencode:mac` / `copy:opencode:win` / `copy:opencode:linux` into each `package:*` target. This ships **both** the 99 MB per-platform native `opencode` binary (under `resources/bin/opencode`) **and** the ~18 MB platform-agnostic Node bundle (under `resources/opencode-node/`).

The legacy copy is currently redundant — nothing in the main-process code reads from `resources/bin/opencode` anymore. It is kept as a rollback safety net until a signed/packaged smoke-test confirms the in-process path works across every distribution channel. The expected follow-up is to drop `copy:opencode*` from the `package:*` scripts and delete `resources/bin/opencode` entirely.

---

## 5. (Add future issues here)
