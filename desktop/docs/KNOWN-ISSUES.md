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

### Affected code paths

| File                                | Relevant location                                     | Notes                                                                             |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/main/index.ts`                 | `registerMcpWithRetry` call (line ~97, startup block) | Fix: re-registers on every startup so OpenCode reconnects immediately             |
| `src/main/opencode-mcp-register.ts` | `registerMcpWithRetry` / `registerMcpWithOpenCode`    | Posts to OpenCode's `/mcp` API to tell it to reinitialize the MCP connection      |
| `src/main/mcp-server.ts`            | `GET /mcp` handler (~line 654)                        | SSE keepalive + dead-stream detection (secondary fix)                             |
| `src/main/mcp-server.ts`            | `handleTransparentReinit`                             | Used by `register_connection` tool; still the fallback if auto-registration fails |

---

## 2. (Add future issues here)
