# Session Channels — Reference

**Source:** `desktop/src/main/mcp-server.ts`, renderer IPC handlers

---

## Overview

A **session channel** is a named, database-backed communication channel that ties an active MCP connection to the renderer UI and to external tooling (VS Code extensions, shell hooks, polling agents, etc.).

Each MCP connection is assigned a `connectionId` (UUID) when it initializes. The session channel for that connection carries the same identifier as its primary key (`session_id`). This means external tools do not need to know the MCP transport session ID — they only need the persisted session identifier (`connectionId`) written to the session file.

## Session Identity

Three identifiers appear in the desktop app and they are not interchangeable:

| Identifier                 | Source                | Used for                                                                                          | Notes                                                                                  |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `openCodeSessionId`        | OpenCode ACP API      | Sidebar tree identity and parent/child topology                                                   | Preferred renderer key when a session is known to OpenCode.                            |
| `connectionId`             | MCP server            | Session channel persistence, prompt routing, destructive actions, REST `/api/sessions/:sessionId` | Stored as `session_channels.session_id` and in `registered_connections.connection_id`. |
| `sessionChannel.sessionId` | Renderer session node | UI-facing copy of the persisted session identifier                                                | For channel-backed nodes this is the same value as `connectionId`.                     |

Renderer sidebar nodes are keyed by `openCodeSessionId ?? connectionId`. That selected node key is not always valid for destructive actions. Clear/remove/dismiss operations must resolve back to the persisted identifier (`sessionChannel.sessionId` / `connectionId`).

### Why session channels exist

The MCP protocol is synchronous and request-driven: a tool call waits for a response, then terminates. Session channels solve two problems that fall outside this model:

1. **User-to-agent messaging.** A user may want to queue a message for the agent to pick up the next time it reads — without the agent currently being in a blocking `request_user_input` call. Session channels persist these messages in SQLite so they survive brief disconnections and app focus loss.

2. **External tool integration.** VS Code extensions, shell hooks, and other polling clients cannot maintain a long-lived SSE connection to the renderer. The REST API layer on top of session channels gives those tools a simple HTTP interface to create channels, read queued messages, and receive cleanup signals.

---

## Database Tables

Three SQLite tables back the session channel system. A fourth table, `skills_and_instructions`, is managed alongside session state but is documented in full in [DATABASE.md — `skills_and_instructions`](./DATABASE.md#skills_and_instructions). It is included in both the `dropAllTables` and `resetDatabase` operations that clear session state.

### `session_channels`

Tracks active named channels. One row per live MCP connection.

| Column       | Type    | Description                             |
| ------------ | ------- | --------------------------------------- |
| `session_id` | TEXT PK | The `connectionId` UUID for the session |
| `label`      | TEXT    | Human-readable name (e.g., `"Agent 1"`) |
| `created_at` | TEXT    | ISO 8601 creation timestamp             |

### `session_messages`

Stores outbound messages queued by the user for the agent to consume.

| Column       | Type    | Description                                        |
| ------------ | ------- | -------------------------------------------------- |
| `id`         | INTEGER | Auto-increment primary key                         |
| `session_id` | TEXT    | Foreign key → `session_channels.session_id`        |
| `message`    | TEXT    | The queued message text                            |
| `sent`       | INTEGER | `0` = unsent (pending agent pickup), `1` = drained |
| `created_at` | TEXT    | ISO 8601 creation timestamp                        |

### `session_channel_history`

Full chronological log of all messages exchanged on a channel. All message types — questions from the agent, answers from the user, outbound messages queued by the user, and agent informational messages — are written here.

| Column       | Type    | Description                                                                                    |
| ------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `id`         | INTEGER | Auto-increment primary key                                                                     |
| `session_id` | TEXT    | Foreign key → `session_channels.session_id`                                                    |
| `type`       | TEXT    | One of `question`, `answer`, `outbound`, `agent_message` (see [Message Types](#message-types)) |
| `message`    | TEXT    | Message content                                                                                |
| `created_at` | TEXT    | ISO 8601 creation timestamp                                                                    |

---

## Message Types

| Type            | Written by         | Description                                                                                |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `question`      | MCP server / agent | A prompt sent to the user via `request_user_input`                                         |
| `answer`        | User (renderer)    | The user's response to a `request_user_input` prompt                                       |
| `outbound`      | User (renderer)    | A message queued by the user for the agent to pick up via `GET /api/sessions/:id/messages` |
| `agent_message` | MCP server / agent | An informational message pushed by the agent via `send_message` (persisted, teal style)    |

`outbound` messages are written to **both** `session_messages` (with `sent=0`) and `session_channel_history` at the same time. When the agent drains the queue, the rows in `session_messages` are marked `sent=1`, but the history record is never modified — the history is an immutable append-only log.

`agent_message` rows are written **only** to `session_channel_history` — they are not enqueued for polling.

---

## REST API Reference

All endpoints are served on `http://localhost:<port>`. The port is discovered via the [session file](#session-files).

| Method   | Path                                      | Request body                            | Success response                                 | Error responses                       |
| -------- | ----------------------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| `POST`   | `/api/sessions`                           | `{ sessionId: string, label?: string }` | `200 { ok: true, sessionId }`                    | `400 { error: "sessionId required" }` |
| `GET`    | `/api/sessions/:sessionId/messages/count` | —                                       | `200 { count: number }`                          | —                                     |
| `GET`    | `/api/sessions/:sessionId/messages`       | —                                       | `200 { messages: [{ id, message, createdAt }] }` | —                                     |
| `DELETE` | `/api/sessions/:sessionId`                | —                                       | `200 { ok: true }`                               | —                                     |

### `POST /api/sessions`

Creates a named channel in the database by calling `createSessionChannel(sessionId, label)`. Sends the `session-channel-created` IPC event to the renderer immediately after creation. Returns `400` if `sessionId` is absent from the request body.

Channels are also created automatically when a new MCP connection opens (see [Lifecycle](#lifecycle)). This endpoint exists for external tools that want to register a channel independently of the MCP handshake.

### `GET /api/sessions/:sessionId/messages/count`

Non-destructive peek at the unsent message queue. Returns the count of rows in `session_messages` where `sent = 0` for the given `sessionId`. **Does not mark any messages as sent.** Polling clients use this endpoint to decide whether to call the drain endpoint.

### `GET /api/sessions/:sessionId/messages`

Drains the unsent message queue. Returns all rows where `sent = 0`, then **immediately marks them as sent** via `markMessagesSent()`. Subsequent calls return an empty `messages` array until the user queues new messages. Each message object in the response contains:

| Field       | Type   | Description                 |
| ----------- | ------ | --------------------------- |
| `id`        | number | Database row ID             |
| `message`   | string | The queued message text     |
| `createdAt` | string | ISO 8601 creation timestamp |

### `DELETE /api/sessions/:sessionId`

This is the full-removal endpoint for a persisted session. Its intended semantics are:

1. Remove the session channel and queued/history rows from SQLite.
2. Remove the matching `registered_connections` row and its ID file.
3. Mark the connection as deleted in the stale-connection guard so later tool calls on that `connectionId` return a re-register error instead of silently failing.
4. Emit renderer events so the UI removes the channel immediately.
5. Fire a `session-tree-invalidated` signal so the renderer pulls a fresh tree and the OpenCode tree state and the sidebar reconcile immediately.

If a live MCP session still exists for that `connectionId`, the removal path must also close it so the persisted and in-memory states stay aligned.

---

## IPC Events Reference

All IPC events travel from the **main process to the renderer** via `webContents.send`. If the `BrowserWindow` is not available, events are silently dropped.

### Events emitted by the session channel system

| Event                              | Payload                          | Trigger                                                                                                                                                          |
| ---------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-channel-created`          | `{ sessionId, label? }`          | `POST /api/sessions` or new MCP connection initialization                                                                                                        |
| `session-channel-deleted`          | `{ sessionId }`                  | `transport.onclose`, `DELETE /mcp`, or `DELETE /api/sessions/:sessionId`                                                                                         |
| `session-channel-messages-cleared` | `{ sessionId }`                  | `window.api.clearSessionChannelMessages(sessionId)` called from renderer                                                                                         |
| `session-status-update`            | `{ connectionId, status, type }` | `push_session_status` MCP tool invoked by the agent                                                                                                              |
| `session-tree-invalidated`         | _(none — payload-free)_          | Session-tree service (SSE events, `register_connection`, session removal, folder change). Renderer pulls the tree via `window.api.getSessionTree()` in response. |

> `session-channel-created` is also sent as part of the standard `connection-opened` IPC flow. See [MCP-SERVER.md](./MCP-SERVER.md#ipc-events-sent-to-renderer) for the full connection event reference.

### Renderer API (`window.api.*`)

These calls are initiated from the renderer and handled in the main process via `ipcRenderer.send` / `ipcMain.handle`.

| Method                                              | Direction       | Description                                                                                                                                                                                                                            |
| --------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.api.queueSessionMessage(sessionId, msg)`    | Renderer → Main | Inserts `msg` into `session_messages` (`sent=0`) and `session_channel_history` (`type='outbound'`). Sends `queue-session-message` IPC event.                                                                                           |
| `window.api.getPersistedSessionChannels()`          | Renderer → Main | Returns persisted session channels joined with `registered_connections` metadata (`openCodeSessionId`, `parentSessionId`). Used as startup reconciliation input.                                                                       |
| `window.api.getSessionChannelHistory(sessionId)`    | Renderer → Main | Returns all rows from `session_channel_history` for the given `sessionId`, ordered chronologically. Used to populate the chat view on load.                                                                                            |
| `window.api.clearSessionChannelMessages(sessionId)` | Renderer → Main | Deletes all history rows for `sessionId` and sends `session-channel-messages-cleared` IPC back to the renderer.                                                                                                                        |
| `window.api.removeSessionChannel(sessionId)`        | Renderer → Main | Force-terminates the associated MCP session, removes persisted channel/registration state, marks the connection deleted, triggers a session-tree refresh, and sends both `connection-closed` and `session-channel-deleted` IPC events. |

---

## Session Files

When a new MCP connection is established, session files are written. External tools read these files to discover the active `sessionId` and `port` without requiring any out-of-band configuration.

| Path                                 | Accessible to                                               |
| ------------------------------------ | ----------------------------------------------------------- |
| `<os.tmpdir()>/imcp-session.json`    | Any process on the machine (system temp directory)          |
| `<process.cwd()>/.imcp-session`      | Processes running in the same working directory as the host |
| `<os.tmpdir()>/imcp-mcp-config.json` | Any process on the machine — MCP config hint for OpenCode   |

The session file (`imcp-session.json` / `.imcp-session`) contains:

```json
{ "sessionId": "<connectionId>", "port": <port> }
```

The MCP config hint file (`imcp-mcp-config.json`) contains a ready-to-use MCP server configuration snippet that external tools (like `opencode-config-sync`) can merge into their MCP config. It uses a remote HTTP entry:

```json
{
  "interactive-desktop": {
    "type": "remote",
    "url": "http://localhost:3100/mcp"
  }
}
```

> `sessionId` here is the `connectionId` UUID generated per connection — the same value used as `session_id` in the database tables. It is **not** the `Mcp-Session-Id` transport header value used in the MCP protocol itself.

The files are deleted:

- When `transport.onclose` fires (client disconnected or session torn down).
- When `restartMcpServer()` is called (explicit server restart).

Write and delete operations on both paths are wrapped in try/catch. A failure to write or delete a session file does not affect connection or channel handling.

---

## Startup Reconciliation

Startup state is reconciled from three sources:

1. `registered_connections` — persisted MCP registration metadata (`connectionId`, `channelName`, `baseDirectory`, `openCodeSessionId`, `parentSessionId`).
2. Live OpenCode sessions — fetched from the OpenCode ACP API by the session-tree manager.
3. Persisted session-channel rows/history — used to recover message history for known `connectionId`s.

The startup sequence is:

1. The main process starts the session-tree manager.
2. The main process runs `reconcileSessionConnections(openCodePort, null)` once at startup. With `null`, this is a **no-op** — reconciliation is deferred until the renderer selects a folder and the `set-selected-folder` IPC handler re-invokes reconcile scoped to the chosen `baseDirectory`. See [`ARCHITECTURE.md — Pinned-folder session pagination`](./ARCHITECTURE.md#pinned-folder-session-pagination).
3. Any `registered_connections` row whose `openCodeSessionId` no longer exists is removed as stale.
4. `fetchSessionTree` seeds the session tree from the OpenCode REST API, scoped to pinned folders and paginated per folder. When `autoRegisterSubagents` is `true`, `autoRegisterSession(info)` is called for each SSE-discovered session, ensuring live OpenCode sessions appear as sidebar channels even before any agent calls `register_connection`. Sessions already present in `registered_connections` are not duplicated.
5. The session-tree service fires a `session-tree-invalidated` signal; the renderer pulls via `window.api.getSessionTree()` and receives a flat snapshot built from live OpenCode sessions merged with remaining `registered_connections` rows.
6. The renderer merges that snapshot into its `SessionNode` map, keyed by `openCodeSessionId ?? connectionId`.
7. For any node that claims a `connectionId`, the renderer loads `getSessionChannelHistory(connectionId)` once and preserves that runtime state across later snapshots.

For OpenCode-backed sessions, sidebar grouping should follow the OpenCode session's own directory/creation metadata. The `registered_connections.base_directory` field is used for repo-aware features such as indexing, `find_repo_docs`, and file completion, but it is not the primary grouping source.

Direct MCP connections that have no OpenCode session are still represented, but they remain keyed directly by `connectionId`.

---

## `push_session_status` — Status Bar Behavior

The `push_session_status` MCP tool allows the agent to post a non-blocking status update to the renderer without waiting for a user response.

- **Tool invocation:** Agent calls `push_session_status` with `{ status: string, type: string }`.
- **IPC event fired:** `session-status-update` → `{ connectionId, status, type }`.
- **Renderer behavior:** `AgentStatusBar` displays the latest status string. A dismiss button is shown so the user can clear it. The update is non-blocking — it does not pause tool execution or require user interaction.

| Field          | Type   | Description                                                         |
| -------------- | ------ | ------------------------------------------------------------------- |
| `connectionId` | string | UUID of the connection that sent the update                         |
| `status`       | string | Human-readable status message to display                            |
| `type`         | string | Visual indicator type (e.g., `info`, `working`, `success`, `error`) |

Each new `session-status-update` for a given `connectionId` replaces the previous status — only the most recent status is shown.

---

## noReply OpenCode Injection

When the user sends a message via `ChannelComposer`, the desktop app delivers it through **two parallel paths**:

1. **Queue path** — `window.api.queueSessionMessage(sessionId, message)` persists the message to SQLite (`session_messages`, `sent=0`) so VS Code extension polling clients can drain it via `GET /api/sessions/:id/messages`.

2. **OpenCode injection path** — `window.api.injectOpenCodeMessage(openCodeSessionId, message, attachments?)` POSTs to the OpenCode ACP HTTP API, injecting the message directly into the agent's active session without triggering a new agent response.

When the provider conversation later contains the canonical user message, the renderer suppresses the duplicate local outbound echo in the unified transcript view.

### OpenCode ACP call

```
POST http://localhost:{openCodePort}/session/{openCodeSessionId}/message
Content-Type: application/json

{
  "noReply": true,
  "parts": [
    {
      "type": "text",
      "text": "<message>\n\n[Image: screenshot.png](http://localhost:{mcpPort}/attachments/<filename>)\n\n--- File: notes.txt ---\n<file content>"
    }
  ]
}
```

The `noReply: true` flag tells OpenCode to inject the text as **context only** — the agent receives it in its next context window but does not generate a response immediately. This behavior is controlled by the **Context-only messages** setting (`noReplyInjection`, default `true`). When the setting is `false`, the `noReply` flag is omitted and the agent will respond to the injected message.

Attachments are encoded as plain-text references appended to the single `text` part:

- **Image attachments** — the main process saves the base64 image into the persistent attachment store under `<userData>/attachments/<uuid>.<ext>`, then appends a markdown link to `http://localhost:{mcpPort}/attachments/<filename>`.
- **Text file attachments** — the file content is inlined as `--- File: <name> ---\n<content>`.

### Attachment Serving

Persisted image attachments are served by the MCP server at `GET /attachments/:filename`.

- The route resolves the filename inside the attachment store.
- Path traversal is rejected by filename sanitization.
- `Content-Type` is inferred from the file extension.
- Missing files return `404 { error: "Attachment not found" }`.
- The server binds to localhost, so attachments are only served to local clients.

Attachment files survive app restarts and are cleaned up periodically by the attachment-store cleanup job.

### When injection is available

Injection is only attempted when an `openCodeSessionId` is stored on the registered connection (set during `register_connection` — see [`TOOLS.md`](./TOOLS.md#opencode-auto-detection)). If no session was detected at registration time, only the queue path runs.

### Subagent awareness

When a subagent is spawned via OpenCode's Task tool and calls `register_connection` with its own `openCodeSessionId`, the desktop app resolves the `parentID` field from the OpenCode API and stores it as `parentSessionId` on the connection. The renderer's `ChannelSidebar` uses this to display the subagent's channel indented under its parent:

```
# Claude Code (parent)
  ↳ # Subagent - fe-specialist
```

A `parentSessionId` on connection A links it as a child of connection B when B's `openCodeSessionId` matches A's `parentSessionId`. Connections with no matching parent are shown at the top level.

#### Session-tree service

The main process runs a `session-tree-service` (`desktop/src/main/session/session-tree-service.ts`) that subscribes to the OpenCode SSE stream and follows a **pull-on-invalidation model**. It holds no cache — OpenCode REST and the local SQLite DB are the sources of truth. On every relevant SSE event (via `session/sse-handlers.ts`), it fires a payload-free `session-tree-invalidated` IPC event (bursts coalesced to ~20 Hz). The renderer then calls `window.api.getSessionTree()` to pull a fresh tree: `fetchSessionTree` calls `fetchRootSessionsForDirectory(port, baseDirectory, limit, archived)` for each pinned folder, builds a depth-annotated tree from the paginated roots and descendants, merges them with `registered_connections` from SQLite, and returns a flat array of `SessionTreeNode` objects (see [`IPC-API.md — Session Tree`](./IPC-API.md#session-tree) for the full type). Folder selection is driven by the renderer via the `setSelectedFolder` IPC call, but pinned projects determine fetch scope — see [`ARCHITECTURE.md — Pinned-folder session pagination`](./ARCHITECTURE.md#pinned-folder-session-pagination).

The renderer uses the pulled tree to build the parent-child sidebar hierarchy.

##### Auto-registration (all sessions)

When the `autoRegisterSubagents` setting is `true` (the default), the session-tree manager automatically registers **all** OpenCode sessions — both root sessions and subagent sessions — as sidebar channels. This happens in two places:

- **SSE `session.created.1` events:** When a new session is detected via live SSE, `autoRegisterSession(info)` is called for every session regardless of whether it has a `parentID`. A `registered_connections` row is created with `connectionId = "auto-{sessionId}"` and a placeholder `channelName`.
- **`seedCacheFromRest` (startup + manual refresh):** When the session tree is seeded from the OpenCode REST API at startup or on user-triggered refresh, `autoRegisterSession(info)` is also called for each session in the results, gated on the `autoRegisterSubagents` toggle.

Because auto-registration fires before the agent connects, sessions initially appear in the sidebar as **placeholder** entries:

- Name: `"Subagent (connecting…)"` (italic, muted)
- A grey pulsing dot instead of the unread-count badge
- Indented under the parent entry (for subagent sessions)

When an agent subsequently calls `register_connection`, the placeholder is replaced by the real connection entry and the pulsing dot disappears. If a direct connection already exists for that `connectionId`, the renderer absorbs its runtime state into the OpenCode-keyed node.

> **No nudge injection.** Auto-registered sessions do **not** receive an injected message prompting them to call `register_connection`. Agents are not expected to call `register_connection` when auto-registration is active — it remains available as an opt-in tool for setting a custom channel name, linking a `baseDirectory`, or enabling doc indexing and session context injection.

When `autoRegisterSubagents` is `false`, no auto-registration occurs. Sessions that have not called `register_connection` still appear as placeholder entries (created from the session-tree poll), but they will not have a `registered_connections` row until the agent calls `register_connection` manually.

See [SETTINGS-CONFIG.md — autoRegisterSubagents](./SETTINGS-CONFIG.md#autoregistersubagents) for the full setting reference.

### Failure handling

If the `injectOpenCodeMessage` IPC call fails (e.g. OpenCode is no longer running, network error), `AgentStatusBar` displays an error status badge. The message is still persisted to the queue path regardless of injection success or failure.

### IPC handler

The injection is handled by the `inject-opencode-message` IPC handler in `ipc-handlers.ts`. See [`IPC-API.md`](./IPC-API.md#opencode-injection) for the full API reference.

---

## Lifecycle

```
Agent                        MCP Server (main)              SQLite                  Renderer
  │                                │                            │                       │
  │  [autoRegisterSubagents=true]  │                            │                       │
  │  (session detected via SSE     │                            │                       │
  │   or seedCacheFromRest)        │                            │                       │
  │                                │── autoRegisterSession() ──>│ INSERT registered_    │
  │                                │                            │  connections (auto-*) │
  │                                │─────── session-tree-invalidated IPC ──────────────>│ (renderer pulls via getSessionTree → placeholder tab)
  │                                │                            │                       │
  │── POST /mcp (initialize) ─────>│                            │                       │
  │                                │── createSessionChannel() ─>│ INSERT session_channels│
  │                                │<──────────────────────────>│                       │
  │                                │─────── session-channel-created IPC ───────────────>│
  │                                │─────── connection-opened IPC ─────────────────────>│ (placeholder → real tab)
  │<─ 200 (Mcp-Session-Id) ────────│                            │                       │
  │                                │                            │                       │
  │── tool: request_user_input ───>│                            │                       │
  │                                │── INSERT history (question)─>│                     │
  │                                │─────────────────────────────────── prompt shown ──>│
  │                                │                            │                       │
  │                                │<─────────────────────────────────── user answers ──│
  │                                │── INSERT history (answer) ─>│                      │
  │<─ tool result (answer) ────────│                            │                       │
  │                                │                            │                       │
  │                                │         (agent is idle)    │                       │
  │                                │                            │  user queues message ─│
  │                                │<── queue-session-message IPC ─────────────────────│
  │                                │── INSERT session_messages ─>│ (sent=0)             │
  │                                │── INSERT history (outbound)─>│                     │
  │                                │                            │                       │
  │── GET /api/sessions/:id/messages>│                          │                       │
  │                                │── SELECT where sent=0 ────>│                       │
  │                                │── markMessagesSent() ──────>│ UPDATE sent=1        │
  │<─ { messages: [...] } ─────────│                            │                       │
  │                                │                            │                       │
  │── DELETE /mcp (disconnect) ───>│                            │                       │
  │   (or transport.onclose fires) │── deleteSessionChannel() ─>│ DELETE session_channels│
  │                                │── clearSessionFile()        │                       │
  │                                │─────── connection-closed IPC ─────────────────────>│
  │                                │─────── session-channel-deleted IPC ───────────────>│ (tab removed)
  │<─ 200 ─────────────────────────│                            │                       │
```

> The top section of the diagram (auto-registration) shows what happens when `autoRegisterSubagents` is `true` and a session is detected before it connects via MCP. The session appears as a placeholder tab in the sidebar immediately. When the agent subsequently opens an MCP connection, the placeholder transitions to a real channel tab. If the agent calls `register_connection`, the placeholder is replaced with the custom channel name provided.

> Current renderer behavior does not preserve a separate restored-tab state after explicit deletion. `session-channel-deleted` removes the owning node immediately; later `session-tree-invalidated` pulls determine what remains visible.

---

## External Tool Integration Pattern

External tools (VS Code extensions, shell hooks) interact with session channels exclusively through the REST API. A typical polling integration:

1. On startup, read `<os.tmpdir()>/imcp-session.json` or `<cwd>/.imcp-session` to obtain `{ sessionId, port }`.
2. Poll `GET http://localhost:<port>/api/sessions/<sessionId>/messages/count` at a desired interval.
3. When `count > 0`, call `GET /api/sessions/<sessionId>/messages` to drain and process the queued messages.
4. To queue a message for the agent, use `POST /api/sessions` to ensure the channel exists, then rely on the renderer's `window.api.queueSessionMessage` path (not directly accessible from external tools — those tools push through the REST layer only).
5. When done, call `DELETE /api/sessions/<sessionId>` to signal session closure.
