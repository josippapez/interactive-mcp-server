# Session Channels — Reference

**Source:** `desktop/src/main/mcp-server.ts`, renderer IPC handlers

---

## Overview

A **session channel** is a named, database-backed communication channel that ties an active MCP connection to the renderer UI and to external tooling (VS Code extensions, shell hooks, polling agents, etc.).

Each MCP connection is assigned a `connectionId` (UUID) when it initializes. The session channel for that connection carries the same identifier as its primary key (`session_id`). This means external tools do not need to know the MCP transport session ID — they only need the `connectionId` that was written to the session file.

### Why session channels exist

The MCP protocol is synchronous and request-driven: a tool call waits for a response, then terminates. Session channels solve two problems that fall outside this model:

1. **User-to-agent messaging.** A user may want to queue a message for the agent to pick up the next time it reads — without the agent currently being in a blocking `request_user_input` call. Session channels persist these messages in SQLite so they survive brief disconnections and app focus loss.

2. **External tool integration.** VS Code extensions, shell hooks, and other polling clients cannot maintain a long-lived SSE connection to the renderer. The REST API layer on top of session channels gives those tools a simple HTTP interface to create channels, read queued messages, and receive cleanup signals.

---

## Database Tables

Three SQLite tables back the session channel system.

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

Removes the channel from the database by calling `deleteSessionChannel(sessionId)` and sends the `session-channel-deleted` IPC event to the renderer.

---

## IPC Events Reference

All IPC events travel from the **main process to the renderer** via `webContents.send`. If the `BrowserWindow` is not available, events are silently dropped.

### Events emitted by the session channel system

| Event                              | Payload                          | Trigger                                                                  |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `session-channel-created`          | `{ sessionId, label? }`          | `POST /api/sessions` or new MCP connection initialization                |
| `session-channel-deleted`          | `{ sessionId }`                  | `transport.onclose`, `DELETE /mcp`, or `DELETE /api/sessions/:sessionId` |
| `session-channel-messages-cleared` | `{ sessionId }`                  | `window.api.clearSessionChannelMessages(sessionId)` called from renderer |
| `session-status-update`            | `{ connectionId, status, type }` | `push_session_status` MCP tool invoked by the agent                      |

> `session-channel-created` is also sent as part of the standard `connection-opened` IPC flow. See [MCP-SERVER.md](./MCP-SERVER.md#ipc-events-sent-to-renderer) for the full connection event reference.

### Renderer API (`window.api.*`)

These calls are initiated from the renderer and handled in the main process via `ipcRenderer.send` / `ipcMain.handle`.

| Method                                              | Direction       | Description                                                                                                                                                      |
| --------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.api.queueSessionMessage(sessionId, msg)`    | Renderer → Main | Inserts `msg` into `session_messages` (`sent=0`) and `session_channel_history` (`type='outbound'`). Sends `queue-session-message` IPC event.                     |
| `window.api.getPersistedSessionChannels()`          | Renderer → Main | Returns all rows from `session_channels`. Used during auto-restore on startup.                                                                                   |
| `window.api.getSessionChannelHistory(sessionId)`    | Renderer → Main | Returns all rows from `session_channel_history` for the given `sessionId`, ordered chronologically. Used to populate the chat view on load.                      |
| `window.api.clearSessionChannelMessages(sessionId)` | Renderer → Main | Deletes all history rows for `sessionId` and sends `session-channel-messages-cleared` IPC back to the renderer.                                                  |
| `window.api.removeSessionChannel(sessionId)`        | Renderer → Main | Force-terminates the associated MCP session, deletes the channel from the database, and sends both `connection-closed` and `session-channel-deleted` IPC events. |

---

## Session Files

When a new MCP connection is established, two session files are written. External tools read these files to discover the active `sessionId` and `port` without requiring any out-of-band configuration.

| Path                              | Accessible to                                               |
| --------------------------------- | ----------------------------------------------------------- |
| `<os.tmpdir()>/imcp-session.json` | Any process on the machine (system temp directory)          |
| `<process.cwd()>/.imcp-session`   | Processes running in the same working directory as the host |

Both files contain the same JSON payload:

```json
{ "sessionId": "<connectionId>", "port": <port> }
```

> `sessionId` here is the `connectionId` UUID generated per connection — the same value used as `session_id` in the database tables. It is **not** the `Mcp-Session-Id` transport header value used in the MCP protocol itself.

The files are deleted:

- When `transport.onclose` fires (client disconnected or session torn down).
- When `restartMcpServer()` is called (explicit server restart).

Write and delete operations on both paths are wrapped in try/catch. A failure to write or delete a session file does not affect connection or channel handling.

---

## Auto-Restore Behavior

When the **Auto-Restore Sessions** setting is enabled, the renderer calls `window.api.getPersistedSessionChannels()` on startup. For each persisted channel returned, the renderer creates a `ConnectionState` entry with `isRestored: true`.

Restored entries appear as channel tabs in the UI and make the stored history available for reading. When the agent reconnects and a live `connection-opened` IPC event arrives for the same `connectionId`, the restored entry is replaced by the live connection state.

If the agent never reconnects (e.g., it was terminated), the restored tab remains visible with its history until the user manually removes it.

---

## `push_session_status` — Status Bar Behavior

The `push_session_status` MCP tool allows the agent to post a non-blocking status update to the renderer without waiting for a user response.

- **Tool invocation:** Agent calls `push_session_status` with `{ status: string, type: string }`.
- **IPC event fired:** `session-status-update` → `{ connectionId, status, type }`.
- **Renderer behavior:** `SessionChannelBar` displays the latest status string. A dismiss button is shown so the user can clear it. The update is non-blocking — it does not pause tool execution or require user interaction.

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

### OpenCode ACP call

```
POST http://localhost:{openCodePort}/session/{openCodeSessionId}/message
Content-Type: application/json

{
  "noReply": true,
  "parts": [
    {
      "type": "text",
      "text": "<message>\n\n[Image file: /tmp/imcp-attachment-<uuid>.png]\n\n--- File: notes.txt ---\n<file content>"
    }
  ]
}
```

The `noReply: true` flag tells OpenCode to inject the text as **context only** — the agent receives it in its next context window but does not generate a response immediately.

Attachments are encoded as plain-text references appended to the single `text` part, mirroring the TUI approach:

- **Image attachments** — the main process writes the base64 image data to a temp file (e.g. `/tmp/imcp-attachment-<uuid>.png`) and appends `[Image file: /tmp/...]` to the message. The agent reads the image from disk.
- **Text file attachments** — the file content is inlined as `--- File: <name> ---\n<content>`.

### When injection is available

Injection is only attempted when an `openCodeSessionId` is stored on the registered connection (set during `register_connection` — see [`TOOLS.md`](./TOOLS.md#opencode-auto-detection)). If no session was detected at registration time, only the queue path runs.

### Failure handling

If the `injectOpenCodeMessage` IPC call fails (e.g. OpenCode is no longer running, network error), `SessionChannelBar` displays an error status badge. The message is still persisted to the queue path regardless of injection success or failure.

### IPC handler

The injection is handled by the `inject-opencode-message` IPC handler in `ipc-handlers.ts`. See [`IPC-API.md`](./IPC-API.md#opencode-injection) for the full API reference.

---

## Lifecycle

```
Agent                        MCP Server (main)              SQLite                  Renderer
  │                                │                            │                       │
  │── POST /mcp (initialize) ─────>│                            │                       │
  │                                │── createSessionChannel() ─>│ INSERT session_channels│
  │                                │<──────────────────────────>│                       │
  │                                │─────── session-channel-created IPC ───────────────>│
  │                                │─────── connection-opened IPC ─────────────────────>│ (new channel tab)
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

> If **Auto-Restore Sessions** is enabled, the `session-channel-deleted` event does not remove the tab immediately. The tab transitions to a restored state and remains visible until the user removes it or the agent reconnects.

---

## External Tool Integration Pattern

External tools (VS Code extensions, shell hooks) interact with session channels exclusively through the REST API. A typical polling integration:

1. On startup, read `<os.tmpdir()>/imcp-session.json` or `<cwd>/.imcp-session` to obtain `{ sessionId, port }`.
2. Poll `GET http://localhost:<port>/api/sessions/<sessionId>/messages/count` at a desired interval.
3. When `count > 0`, call `GET /api/sessions/<sessionId>/messages` to drain and process the queued messages.
4. To queue a message for the agent, use `POST /api/sessions` to ensure the channel exists, then rely on the renderer's `window.api.queueSessionMessage` path (not directly accessible from external tools — those tools push through the REST layer only).
5. When done, call `DELETE /api/sessions/<sessionId>` to signal session closure.
