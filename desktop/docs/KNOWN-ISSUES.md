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

### Secondary issue: dead SSE stream while prompt is active — RESOLVED

> **Status: RESOLVED** — see [Issue #2](#2--32000-connection-closed-errors-when-prompt-timeout-is-large-resolved) for the full fix.

A separate (less common) scenario: the app is backgrounded long enough for the OS to kill its idle TCP connections while a prompt is actively waiting. In this case, `activeClients > 0` but the tool result can never be delivered because the SSE GET stream's TCP socket is dead.

**Previous fix**: SSE keepalive heartbeat (15s `": keepalive\n\n"` comments on `GET /mcp`) + socket `close`/`error` listener that called `cancelActivePrompt` when the SSE stream died. Implemented in `src/main/mcp-server.ts` GET /mcp handler.

**Current fix**: The entire SSE streaming mode has been replaced by `enableJsonResponse: true` (plain JSON HTTP responses). The keepalive heartbeat and SSE close-handler `cancelActivePrompt` calls have been removed. Prompts are now durable and transport-independent. See Issue #2 below for details.

### Affected code paths

| File                                | Relevant location                                     | Notes                                                                             |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/main/index.ts`                 | `registerMcpWithRetry` call (line ~97, startup block) | Fix: re-registers on every startup so OpenCode reconnects immediately             |
| `src/main/opencode-mcp-register.ts` | `registerMcpWithRetry` / `registerMcpWithOpenCode`    | Posts to OpenCode's `/mcp` API to tell it to reinitialize the MCP connection      |
| `src/main/mcp-server.ts`            | `StreamableHTTPServerTransport` constructor           | Now uses `enableJsonResponse: true` — no SSE streams                              |
| `src/main/mcp-server.ts`            | `handleTransparentReinit`                             | Used by `register_connection` tool; still the fallback if auto-registration fails |
| `src/main/ipc-prompt.ts`            | `activePrompts` Map / `DurablePromptState`            | Durable prompt state, independent of HTTP transport                               |

---

## 2. `-32000` "Connection closed" errors when prompt timeout is large — RESOLVED

### Symptom

When the user-configured prompt timeout was large (e.g., 1200s) or infinite (`0`), the MCP tool call would fail with `-32000 Connection closed`. The agent would receive an error like `"No connection established for request ID"`, making the tool result undeliverable.

### Root cause

Three layers contributed to this problem:

1. **SSE stream bound to TCP connection.** The SDK's `StreamableHTTPServerTransport` creates a per-POST SSE `ReadableStream` tightly bound to the HTTP response. When the TCP connection drops (OS idle timeout, proxy timeout, network interruption), the stream's `cancel()` callback fires, removing it from `_streamMapping`. Subsequent `send()` calls then silently fail or throw because no stream exists for the request ID.

2. **Prompt cancellation on connection drop.** `cancelActivePrompt()` was called from both `transport.onclose` and the SSE socket `close` handler in `mcp-server.ts`. This killed the prompt state on every connection drop — even transient ones the agent would have retried transparently.

3. **No cross-connection result delivery.** There was no mechanism to deliver a tool result on a different HTTP connection than the one the original request arrived on. Once the originating connection dropped, the result was permanently lost.

### Fix (3 parts, all on `main` branch)

#### Part 1: `enableJsonResponse: true` (`mcp-server.ts`)

Switched the `StreamableHTTPServerTransport` constructor to use `enableJsonResponse: true`. This changes the SDK from SSE streaming to plain JSON HTTP responses. The POST request blocks until the tool handler's Promise resolves, then sends a single JSON response body. There is no long-lived SSE stream that can drop.

**Commit:** `02efad0` — fix: switch to enableJsonResponse mode

#### Part 2: Durable prompt state (`ipc-prompt.ts`)

Prompts now live in main-process memory via an `activePrompts` Map (`DurablePromptState`), completely independent of the HTTP transport. If the connection drops and the agent retries (transparent reinit), the retry call to `promptUser()` detects the existing durable state (matched by prompt content hash) and attaches to the same underlying Promise — no duplicate UI prompt is spawned.

**Commit:** `dbd8c41` — feat: durable prompt state

#### Part 3: Removed `cancelActivePrompt` from transport/SSE close handlers (`mcp-server.ts`)

Prompts now only cancel on explicit, intentional actions:

- `DELETE /mcp` (session teardown)
- `forceTerminateChat` (user-initiated kill)
- `_clearAllSessions` (full reset)
- The prompt's own timeout timer expiring

Connection drops no longer cancel prompts.

**Commit:** `c07ba10` — fix: stop cancelling prompts on transport/SSE close

### Remaining limitation

With `0` timeout (infinite wait), the OpenCode MCP client's own HTTP request timeout (~120s) still fires, causing the client to retry the tool call. The durable prompt handles this gracefully — retries attach to the existing prompt's Promise — but the user may see repeated prompt attempts from the agent in the chat log. **Recommendation:** set a finite timeout (e.g., 1200s) to avoid client-side retries.

### Affected code paths

| File                     | Relevant location                           | Notes                                                                    |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| `src/main/mcp-server.ts` | `StreamableHTTPServerTransport` constructor | `enableJsonResponse: true` — no SSE streams                              |
| `src/main/mcp-server.ts` | Transport/SSE close handlers                | `cancelActivePrompt` calls removed                                       |
| `src/main/ipc-prompt.ts` | `activePrompts` Map / `DurablePromptState`  | Durable prompt state; retries attach to existing promise                 |
| `src/main/ipc-prompt.ts` | `promptUser()`                              | Detects duplicate prompts by content hash and reuses the durable promise |

---

## 3. (Add future issues here)
