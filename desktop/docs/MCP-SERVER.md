# MCP Server — Implementation Reference

**Source:** `desktop/src/main/mcp-server.ts`, `desktop/src/main/api-routes.ts`

---

## Overview

The Interactive MCP Desktop app exposes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server over HTTP using the `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`. The HTTP layer is an Express 5 application that is started in the Electron main process.

One `McpServer` instance is created **per client connection**. Each server instance has all tools registered against it, is bound to its own `StreamableHTTPServerTransport`, and is torn down when the session ends. Multiple simultaneous client connections are supported via an in-memory `sessions` map keyed by MCP session ID.

---

## Startup

```ts
startMcpServer(port, getWindow, getSoundEnabled, getPromptTimeoutMs);
```

| Parameter            | Type                          | Description                                                              |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `port`               | `number`                      | TCP port the Express server binds to                                     |
| `getWindow`          | `() => BrowserWindow \| null` | Accessor for the Electron renderer window (used for IPC)                 |
| `getSoundEnabled`    | `() => boolean`               | Accessor for the user's sound-enabled preference (default: `() => true`) |
| `getPromptTimeoutMs` | `() => number`                | Accessor for prompt timeout in milliseconds (default: `() => 800_000`)   |

All four parameters are stored in module-level `_startParams` so that `restartMcpServer()` can replay an identical startup without being called again by the caller.

### OpenCode startup registration

When `agentBackend === 'opencode'`, `index.ts` calls `registerMcpWithRetry` immediately after the MCP server starts. This POSTs to OpenCode's `/mcp` API (`http://localhost:{openCodePort}/mcp`), registering the Desktop as a remote MCP server and causing OpenCode to perform a fresh `initialize` handshake right away.

Without this call, OpenCode's `type: "remote"` client retains a stale connection state from the previous server instance and may take tens of seconds to reconnect on its own backoff schedule — during which any agent tool calls queue silently inside OpenCode and never reach the Desktop app.

The call is fire-and-forget with exponential-backoff retries (up to 5 attempts) so it handles the case where OpenCode is not yet running at the moment the Desktop launches. See `src/main/opencode-mcp-register.ts` for implementation details and `docs/KNOWN-ISSUES.md #1` for the full bug description.

---

## HTTP Endpoint Reference

All endpoints are served on `http://localhost:<port>`.

### MCP Protocol Endpoints

| Method   | Path   | Description                                                                                                   |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/mcp` | Route a request to an existing session, initialize a new session, or perform transparent session resurrection |
| `GET`    | `/mcp` | Open an SSE stream for server-to-client messages                                                              |
| `DELETE` | `/mcp` | Tear down the client session                                                                                  |

#### `POST /mcp`

The handler inspects the `mcp-session-id` request header and the request body to decide which of three code paths to execute:

**Case 1 — Known session ID**

- The `mcp-session-id` header matches a live entry in `sessions`.
- The request is forwarded directly to `transport.handleRequest(req, res, req.body)`.

**Case 2 — Initialize request (new or reconnecting client)**

- Either no `mcp-session-id` header is present, or the header refers to a session that no longer exists, **and** `isInitializeRequest(req.body)` returns `true`.
- A new `connectionId` (UUID), `connectionName` (`OpenCode - Main Channel` for the first runtime connection, then `Agent N`), `McpServer`, and `StreamableHTTPServerTransport` are created.
- `onsessioninitialized` registers the session in the `sessions` map, auto-registers a default named channel (see **Default channel bootstrap** below), writes the session file, and sends `connection-opened` IPC to the renderer.
- The transport's `onclose` handler is wired (see [Session Close](#session-close)).
- The request is forwarded to the new transport.

**Case 3 — Stale session ID + non-initialize body (transparent reinit)**

- The `mcp-session-id` header refers to a session that no longer exists **and** the body is not an `initialize` request (e.g., a tool call arriving after a server restart).
- `handleTransparentReinit(req, res)` is invoked. See [Transparent Session Resurrection](#transparent-session-resurrection).
- If `handleTransparentReinit` throws, the handler falls back to a JSON-RPC 404 error response.

**Fallback — 404**

Two sub-cases reach this point:

- No `mcp-session-id` header and the body is not an initialize request.
- `handleTransparentReinit` was attempted (stale session ID present) but threw an exception.

```json
// 404 response body
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Session not found or expired. Please reinitialize."
  },
  "id": null
}
```

---

#### `GET /mcp`

Opens a Server-Sent Events (SSE) stream. The `mcp-session-id` header must match a live session; otherwise returns `404 { error: "Session not found or expired" }`.

The stream is managed entirely by `StreamableHTTPServerTransport` — the server emits tool results and notifications over this channel.

---

#### `DELETE /mcp`

Client-initiated session teardown. The `mcp-session-id` header must match a live session.

Behavior on a valid session:

1. Forwards to `transport.handleRequest` (allows the transport to send a final response and close the transport, which will trigger `transport.onclose`).
2. Removes the session from the `sessions` map.
3. Calls `cancelActivePrompt(connectionId)`.
4. Sends `connection-closed` IPC to the renderer.

Note: `deleteSessionChannel`, `clearSessionFile`, and `session-channel-deleted` IPC are **not** called directly by the `DELETE` handler — they are triggered via `transport.onclose` when the transport closes after the request completes.

Returns `404` if no matching session exists.

---

### Session Channel REST API

These endpoints operate on the database-backed session channel store. They are used by the VS Code extension and similar polling clients that cannot maintain a long-lived SSE connection.

| Method   | Path                                      | Request body / params                   | Response                                                           |
| -------- | ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `POST`   | `/api/sessions`                           | `{ sessionId: string, label?: string }` | `{ ok: true, sessionId }` or `400 { error: "sessionId required" }` |
| `GET`    | `/api/sessions/:sessionId/messages/count` | —                                       | `{ count: number }`                                                |
| `GET`    | `/api/sessions/:sessionId/messages`       | —                                       | `{ messages: Message[] }` (marks messages as sent)                 |
| `DELETE` | `/api/sessions/:sessionId`                | —                                       | `{ ok: true }`                                                     |

**`POST /api/sessions`** — Creates a named channel in the database and sends `session-channel-created` IPC to the renderer.

**`GET /api/sessions/:sessionId/messages/count`** — Non-destructive peek at the unsent message queue. Does **not** mark messages as sent. Used by polling clients to determine whether to drain.

**`GET /api/sessions/:sessionId/messages`** — Drains the unsent message queue. All returned messages are immediately marked as sent in the database.

**`DELETE /api/sessions/:sessionId`** — Intended as a full-removal path for a persisted session: remove channel state, remove registration state, guard against stale follow-up tool calls, emit renderer deletion events, and refresh the session-tree snapshot.

### `GET /attachments/:filename`

Serves persisted image attachments from the local attachment store.

- Attachment files live under `<userData>/attachments/<uuid>.<ext>`.
- The route sanitizes the filename and rejects path traversal.
- `Content-Type` is inferred from the extension.
- Missing files return `404 { error: "Attachment not found" }`.
- This route is used by OpenCode injection for image attachments, which are referenced as `http://localhost:<port>/attachments/<filename>` markdown links.

---

### Utility Endpoints

| Method | Path             | Description                                                                                                                                                                   |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/reconnect` | Soft-restart: clears all in-memory MCP sessions but keeps the HTTP listener running. Returns `{ ok: true, cleared: <n>, message: "..." }` with the count of cleared sessions. |
| `GET`  | `/health`        | Returns server status, active connection count, and registered tool names.                                                                                                    |

**`GET /health` response shape:**

```json
{
  "status": "ok",
  "activeClients": 2,
  "mcpConfigFile": "<path to imcp-mcp-config.json>",
  "tools": [
    "register_connection",
    "request_user_input",
    "start_intensive_chat",
    "ask_intensive_chat",
    "stop_intensive_chat",
    "push_session_status",
    "send_message",
    "find_repo_docs",
    "manage_skills_and_instructions"
  ]
}
```

---

## Session Lifecycle

```
Client                          MCP Server                       Renderer (IPC)
  │                                  │                                 │
  │── POST /mcp (initialize) ───────>│                                 │
  │                                  │── onsessioninitialized          │
  │                                  │   sessions[newId] = { ... }     │
  │                                  │── createSessionChannel(connId)  │
  │                                  │── writeSessionFile(connId, port)│
  │                                  │──────── connection-opened ─────>│
  │<─ 200 (Mcp-Session-Id: newId) ───│                                 │
  │                                  │                                 │
  │── POST /mcp (tool call) ────────>│                                 │
  │   mcp-session-id: newId          │                                 │
  │                                  │── transport.handleRequest       │
  │<─ 200 (tool result) ─────────────│                                 │
  │                                  │                                 │
  │── GET /mcp (SSE) ───────────────>│                                 │
  │<═══════════════════════ SSE ════>│                                 │
  │                                  │                                 │
  │── DELETE /mcp ──────────────────>│                                 │
  │   mcp-session-id: newId          │                                 │
  │                                  │── cancelActivePrompt(connId)    │
  │                                  │──────── connection-closed ─────>│
  │<─ 200 ───────────────────────────│                                 │
```

### Session Close

When `transport.onclose` fires (either from `DELETE /mcp` or from the transport detecting a dropped connection), the following cleanup sequence runs:

1. Remove the session entry from the `sessions` map.
2. Call `cancelActivePrompt(connectionId)` — cancels any pending `request_user_input` or intensive-chat prompts waiting on renderer responses.
3. Call `deleteSessionChannel(connectionId)` — removes the session channel from the database.
4. Call `clearSessionFile()` — deletes both session file paths (see [Session Files](#session-files)).
5. Send `connection-closed` IPC to the renderer with `{ connectionId }`.
6. Send `session-channel-deleted` IPC to the renderer with `{ sessionId: connectionId }`.
7. Call `server.close()` to shut down the per-connection `McpServer`.

The `transport.onclose` cleanup path does **not** delete `registered_connections`; explicit user/session removal paths handle that separately.

---

## Transparent Session Resurrection

When a client holds a **stale session ID** (e.g., the server was restarted or the session was evicted) and sends a **non-initialize request** such as a tool call, the server runs `handleTransparentReinit`. The goal is to silently establish a new valid MCP session and service the original request without the client ever receiving an error.

### Step-by-step

1. **Allocate a new connection.** Increment `connectionCounter`, generate a new `connectionId` (UUID), derive `connectionName` (`OpenCode - Main Channel` for the first runtime connection, then `Agent N`), and create a fresh `McpServer` via `createMcpServerWithTools`.

2. **Create a new transport.** Instantiate `StreamableHTTPServerTransport` with a `sessionIdGenerator` and an `onsessioninitialized` callback. When `onsessioninitialized` fires:
   - Register the session in `sessions[newSessionId]`.
   - Auto-register a default named channel in `registered_connections` and `session_channels`.
   - Write the session file.
   - Send `connection-opened` IPC to the renderer.
   - Wire `transport.onclose` with the standard cleanup sequence.

3. **Run the MCP initialize handshake internally.** The MCP protocol requires an `initialize` → `notifications/initialized` exchange before tool calls are valid. Because the client skipped this step, the server performs it internally:
   - A synthetic `initialize` request body is constructed using `LATEST_PROTOCOL_VERSION` and a placeholder `clientInfo` of `{ name: "cli-reconnect", version: "1.0.0" }`.
   - A **no-op response object** (implementing the minimum Express `Response` surface — `setHeader`, `getHeader`, `status`, `json`, `end`, `write`, `on`, `once`, `emit`) is used in place of the real HTTP response so the internal initialize response is discarded silently.
   - `server.connect(transport)` is called, then `transport.handleRequest(fakeReq, noopRes, initBody)` drives the initialize exchange.
   - A `Promise` wraps this step and resolves only once `onsessioninitialized` confirms the session ID is assigned.

4. **Send `notifications/initialized`.** A second synthetic request containing `{ jsonrpc: "2.0", method: "notifications/initialized" }` is forwarded through the transport using another no-op response object. This completes the MCP handshake.

5. **Patch session ID headers.**
   - `res.setHeader('Mcp-Session-Id', newSessionId)` — the real HTTP response now carries the new session ID so the client can update its stored session ID.
   - `req.headers['mcp-session-id'] = newSessionId` — patches the incoming request so `transport.handleRequest` sees the correct session ID when it processes the forwarded request.

6. **Forward the original request.** `transport.handleRequest(req, res, req.body)` processes the client's original tool call against the now-initialized transport. The client receives a normal tool result response.

If `handleTransparentReinit` throws at any point, the `POST /mcp` handler catches the error, logs it, and falls through to the standard 404 JSON-RPC error response.

---

## Session Files

Three files are written whenever a new connection is established, and deleted whenever a session is closed or the server is restarted. The session file logic is extracted to `desktop/src/main/session-file.ts`.

| Path                                 | Purpose                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `<os.tmpdir()>/imcp-session.json`    | System temp — accessible to any process on the machine                                             |
| `<process.cwd()>/.imcp-session`      | CWD-relative — accessible to processes in the same working directory (e.g., a local CLI)           |
| `<os.tmpdir()>/imcp-mcp-config.json` | Ready-to-use MCP server config snippet with remote HTTP connection options for OpenCode and others |

The session file (`imcp-session.json` and `.imcp-session`) contains:

```json
{ "sessionId": "<connectionId>", "port": <port> }
```

The MCP config hint file (`imcp-mcp-config.json`) contains a ready-to-use remote configuration:

```json
{
  "interactive-desktop": {
    "type": "remote",
    "url": "http://localhost:3100/mcp"
  }
}
```

Note: `sessionId` in the file is the internal `connectionId` (a UUID generated per connection), **not** the MCP transport session ID used in `Mcp-Session-Id` headers. This persisted identifier is also the value used by `session_channels.session_id`, REST `/api/sessions/:sessionId`, and renderer `sessionChannel.sessionId`. Write and delete operations on both paths are wrapped in try/catch and are non-critical — a failure to write or delete a session file does not affect connection handling.

### When files are cleared

- `transport.onclose` fires (client disconnected or session torn down).
- `restartMcpServer()` is called (explicit restart clears files before re-listening).

---

## Per-Connection McpServer Model

Each accepted connection receives its own isolated `McpServer` instance. Isolation ensures that tool state, prompt queues, and cancellation signals are scoped to a single client.

`createMcpServerWithTools(getWindow, connectionId, connectionName)` constructs the server and registers all tools:

| Tool registration function                | Tool(s) registered                                                  |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `registerRequestUserInput`                | `request_user_input`                                                |
| `registerIntensiveChatTools`              | `start_intensive_chat`, `ask_intensive_chat`, `stop_intensive_chat` |
| `registerSessionChannelTools`             | `push_session_status`                                               |
| `registerSendMessageTool`                 | `send_message`                                                      |
| `registerConnectionTool`                  | `register_connection`                                               |
| `registerFindRepoDocsTool`                | `find_repo_docs`                                                    |
| `registerManageSkillsAndInstructionsTool` | `manage_skills_and_instructions`                                    |

Both `connectionId` and `connectionName` are passed to tool registrations that need to route IPC or database operations to the correct renderer session (e.g., prompts routed to the correct input bar, cancellation tied to the right connection).

The `McpServer` is declared with:

```ts
{ name: 'Interactive MCP Desktop', version: '1.0.0' }
{ capabilities: { tools: {} } }
```

When the session ends, `server.close()` is called as the final cleanup step.

---

## IPC Events Sent to Renderer

All events are sent via `webContents.send` on the `BrowserWindow` returned by `getWindow()`. If `getWindow()` returns `null`, the send is silently skipped.

| Event                     | Payload                                    | Trigger                                                  |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `connection-opened`       | `{ connectionId, name, sessionId, label }` | New session initialized (`onsessioninitialized`)         |
| `connection-closed`       | `{ connectionId }`                         | `transport.onclose` or `DELETE /mcp`                     |
| `session-channel-created` | `{ sessionId, label }`                     | `POST /api/sessions`                                     |
| `session-channel-deleted` | `{ sessionId }`                            | `transport.onclose` or `DELETE /api/sessions/:sessionId` |

> `connectionId` in `connection-opened` and `connection-closed` is the UUID generated at connection time. `sessionId` in `connection-opened` is also set to `connectionId` (not the MCP transport session ID). Renderer sidebar keys may instead be `openCodeSessionId` when an OpenCode session is known.

---

## Restart and Recovery

### `stopMcpServer()`

Calls `httpServer.closeAllConnections()` and `httpServer.close()`. Sets `httpServer` and `_sessionCleanup` to `null`. The in-memory `sessions` map is scoped to the `startMcpServer` closure and is implicitly dropped.

### `restartMcpServer()`

```
stopMcpServer() → clearSessionFile() → startMcpServer(_startParams...)
```

Requires that `_startParams` was populated by a prior `startMcpServer` call. If called before `startMcpServer` has ever run, it is a no-op. This is a **hard restart** — the HTTP listener is stopped entirely and all in-memory sessions are lost. Clients will see `ECONNREFUSED` until the new server is listening. Used when the port changes (via Settings).

### `softRestartMcpServer()`

Clears all in-memory MCP sessions (transports, servers, active prompts) but **keeps the HTTP listener running**. Each session's server is closed before its transport so in-flight tool handlers see the SDK abort signal, active prompts are cancelled via `cancelActivePrompt`, session channels are deleted from SQLite, and the renderer is notified with `connection-closed` and `session-channel-deleted` IPC events.

The next client request will trigger either:

- A fresh `initialize` handshake (per MCP spec), or
- A **transparent session resurrection** — the server creates a new session internally, runs the MCP handshake behind the scenes, and forwards the original request so the client never sees an error.

This is the preferred approach for in-app "reconnect" operations since it avoids the TCP downtime window that causes OpenCode (and other `type: "remote"` clients) to require manual toggling.

**Accessible via:**

- IPC: `reconnect-mcp-server` handler (called from Settings UI)
- REST: `POST /api/reconnect` endpoint (returns `{ ok, cleared, message }`)

Returns the number of sessions that were cleared, or `0` if the server is not running.

### `closeSessionByConnectionId(connectionId)`

Finds the MCP session ID corresponding to `connectionId` via a linear scan of `sessions`, removes it from the map, then calls `server.close()` followed by `transport.close()` on that entry. Returns `true` if a session was found and closed, `false` otherwise.

Important: `cancelActivePrompt`, `deleteSessionChannel`, `clearSessionFile`, and IPC events are **not** called directly by this function — they run only if `transport.onclose` fires as a consequence of `transport.close()`. This is used for programmatic session eviction (e.g., from the renderer UI's disconnect button).

### Client recovery after server restart

Clients that send a tool call immediately after a server restart carry a stale `mcp-session-id`. The [Transparent Session Resurrection](#transparent-session-resurrection) mechanism handles this case automatically — clients do not need to implement any reconnect logic beyond reading the `Mcp-Session-Id` response header to update their stored session ID.

---

## Dock-launch Guards

When the Electron app is launched from the macOS Dock or registered as a login item, the OS starts the process with a working directory of `/`. Two subsystems that depend on a meaningful working directory contain explicit guards against this:

### `opencode-server.ts` — `startOpenCodeServer()` spawn `cwd`

`spawn()` is always called with an explicit `cwd` option:

```ts
const spawnCwd = process.env.HOME ?? process.env.USERPROFILE ?? '/';
child = spawn(opencodeBin, ['serve', '--port', String(port)], {
  cwd: spawnCwd,
  ...
});
```

Without this, `opencode serve` would inherit `/` as its working directory and immediately begin scanning the filesystem root, producing a flood of permission-denied errors and high I/O load.

### `mcp-server.ts` — `autoRegisterDefaultConnection()` `baseDirectory` guard

`autoRegisterDefaultConnection()` derives the `baseDirectory` for the default channel registration from `process.cwd()`. When the value is `/` or empty, it falls back to the user's home directory instead:

```ts
const rawCwd = process.cwd();
const baseDirectory =
  rawCwd === '/' || rawCwd === ''
    ? (process.env.HOME ?? process.env.USERPROFILE ?? rawCwd)
    : rawCwd;
```

Without this guard, the doc indexer (`doc-context-injector.ts`) would receive `/` as the `baseDirectory` and attempt to walk the entire filesystem to discover documentation files.
