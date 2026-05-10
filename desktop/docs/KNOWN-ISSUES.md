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

## 3. Wasm copy layout sensitivity (resolved — Mode A bundle no longer packaged)

> **Resolved:** the `opencode:copy-server-assets` Vite plugin and the `resources/opencode-node/` directory were removed when the app committed to Mode C (`RUNTIME_KIND = 'native-subprocess'`). The native `opencode` binary loads its own tree-sitter grammars internally; the Electron main bundle no longer ships them. Kept here as historical context: if Mode A is ever reactivated (see `desktop/src/main/opencode/runtime-mode.ts`), the wasm-copy plugin must be restored and its target directory must match the chunk layout — upstream `packages/desktop-electron` emits chunks under `out/main/chunks/` and copies wasm there, while our previous layout kept the chunk and wasm both at `out/main/`.

---

## 4. Legacy `copy:opencode*` still wired into packaging (resolved)

> **Resolved:** the app committed to Mode C (`RUNTIME_KIND = 'native-subprocess'`). The Mode A Node bundle (`resources/opencode-node/`) and the `copy:opencode-node` script are no longer packaged; the `opencode:copy-server-assets` and Mode A path-rewrite Vite plugins have been removed/stubbed. Only the per-platform native binary (now under `resources/opencode-bin/<platform>-<arch>/`, copied by `copy:opencode-bin`) is shipped. To reactivate Mode A, see the stub error message in `electron.vite.config.ts` and the reactivation hint at `desktop/src/main/opencode/runtime-mode.ts`.

---

## 5. (Add future issues here)
