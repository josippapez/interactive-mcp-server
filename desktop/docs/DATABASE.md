# Database Layer — Interactive MCP Desktop

## Overview

The desktop application stores conversation history and session channel state in a
SQLite database managed by **[sql.js](https://sql-js.github.io/sql.js/)** — SQLite
compiled to WebAssembly and running entirely in the Node.js (Electron main) process.

### Why sql.js?

sql.js requires no native compilation step and therefore ships without platform-specific
binaries. This makes it straightforward to package and distribute as part of an Electron
application without `node-gyp` or rebuild hooks. The trade-off is that the entire
database is held in memory as a WASM-managed byte array and must be explicitly flushed to
disk after every mutation.

### Persistence model

There is no WAL file, no shared-memory file, and no background flush timer. After every
write operation the internal `persist()` helper calls `db.export()`, wraps the result in
a `Buffer`, and writes the complete database file to disk with `writeFileSync`. This means:

- **Every mutation is immediately durable** — a crash between two writes cannot leave
  the file in a partially-written state.
- **Write amplification** — the entire database is rewritten on every mutation,
  regardless of which rows changed. For the anticipated data volumes (thousands of
  conversation records) this is acceptable, but it would not scale to high-frequency
  bulk writes.
- **No concurrent access** — because the database lives in WASM memory and is only
  serialised on explicit persist calls, concurrent reads from multiple processes would
  read stale file contents. The application is designed for single-process access via
  the Electron main process.

---

## File Location

```
{app.getPath('userData')}/conversations.db
```

`app.getPath('userData')` resolves to the platform-specific application data directory
managed by Electron:

| Platform | Typical path                                |
| -------- | ------------------------------------------- |
| macOS    | `~/Library/Application Support/<app-name>/` |
| Windows  | `%APPDATA%\<app-name>\`                     |
| Linux    | `~/.config/<app-name>/`                     |

The resolved absolute path is stored in the module-level `dbPath` variable and set
during `initDatabase()`.

---

## Schema

### `conversations`

Stores the record of every single-shot prompt/response exchange (i.e. the
`request_user_input` MCP tool calls).

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  prompt_message    TEXT     NOT NULL,
  project_name      TEXT     NOT NULL,
  user_response     TEXT     NOT NULL,
  predefined_options TEXT,              -- JSON array of strings, or NULL
  attachments        TEXT,              -- JSON array of attachment objects, or NULL
  created_at         TEXT    DEFAULT (datetime('now'))
);
```

| Column               | Type    | Nullable | Description                                                            |
| -------------------- | ------- | -------- | ---------------------------------------------------------------------- |
| `id`                 | INTEGER | No       | Auto-incrementing primary key.                                         |
| `prompt_message`     | TEXT    | No       | The message text shown to the user.                                    |
| `project_name`       | TEXT    | No       | Identifier for the project/context that issued the prompt.             |
| `user_response`      | TEXT    | No       | The text the user entered in response.                                 |
| `predefined_options` | TEXT    | Yes      | JSON-serialised `string[]` of quick-select options, or `NULL` if none. |
| `attachments`        | TEXT    | Yes      | JSON-serialised array of attachment objects (see below), or `NULL`.    |
| `created_at`         | TEXT    | No       | UTC timestamp string produced by SQLite's `datetime('now')`.           |

**Attachment object shape** (when `attachments` is not `NULL`):

```ts
{
  data: string; // base64-encoded file contents
  mimeType: string; // e.g. "image/png"
  name: string; // original filename
  size: number; // size in bytes
}
```

---

### `session_channels`

Tracks open intensive-chat sessions. One row per active session.

```sql
CREATE TABLE IF NOT EXISTS session_channels (
  session_id TEXT     PRIMARY KEY,
  label      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| Column       | Type     | Nullable | Description                                              |
| ------------ | -------- | -------- | -------------------------------------------------------- |
| `session_id` | TEXT     | No       | Caller-supplied unique session identifier (primary key). |
| `label`      | TEXT     | Yes      | Human-readable display label for the session, or NULL.   |
| `created_at` | DATETIME | No       | Row creation timestamp (SQLite `CURRENT_TIMESTAMP`).     |

---

### `session_messages`

Outbound message queue for intensive-chat sessions. Messages are inserted with
`sent = 0` and marked `sent = 1` once the renderer has acknowledged them.

```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  message    TEXT     NOT NULL,
  sent       INTEGER  DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| Column       | Type     | Nullable | Description                                                      |
| ------------ | -------- | -------- | ---------------------------------------------------------------- |
| `id`         | INTEGER  | No       | Auto-incrementing primary key.                                   |
| `session_id` | TEXT     | Yes      | Foreign reference to `session_channels.session_id`.              |
| `message`    | TEXT     | No       | Serialised message payload.                                      |
| `sent`       | INTEGER  | No       | `0` = pending delivery, `1` = delivered. Boolean encoded as int. |
| `created_at` | DATETIME | No       | Row creation timestamp.                                          |

---

### `session_channel_history`

Append-only audit log of all messages flowing through a session channel.
Records questions sent to the user, answers received, and outbound messages
queued by the server.

```sql
CREATE TABLE IF NOT EXISTS session_channel_history (
  id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT     NOT NULL,
  message_type TEXT     NOT NULL,   -- 'question' | 'answer' | 'outbound'
  message_text TEXT     NOT NULL,
  attachments  TEXT,                -- JSON array of attachment objects, or NULL
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| Column         | Type     | Nullable | Description                                                                                         |
| -------------- | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| `id`           | INTEGER  | No       | Auto-incrementing primary key. Used to preserve insertion order on reads.                           |
| `session_id`   | TEXT     | No       | Foreign reference to `session_channels.session_id`.                                                 |
| `message_type` | TEXT     | No       | `'question'` — prompt sent to user; `'answer'` — user reply; `'outbound'` — server-queued message.  |
| `message_text` | TEXT     | No       | Full message content.                                                                               |
| `attachments`  | TEXT     | Yes      | JSON-serialised array of attachment objects (same shape as `conversations.attachments`), or `NULL`. |
| `created_at`   | DATETIME | No       | Row creation timestamp.                                                                             |

---

## Initialization and Migrations

### `initDatabase(): Promise<void>`

Called once during application startup (Electron `main` process). Performs the following
steps in order:

1. Resolves `dbPath` to `{userData}/conversations.db`.
2. Initialises the sql.js WASM engine via `initSqlJs()`.
3. If `dbPath` exists on disk, reads the file into a `Buffer` and passes it to
   `new SQL.Database(buffer)` to restore the existing database.
4. If `dbPath` does not exist, creates a fresh in-memory database with
   `new SQL.Database()`.
5. Runs `CREATE TABLE IF NOT EXISTS` for all four tables (order:
   `conversations` → `session_channels` → `session_messages` →
   `session_channel_history`).
6. Runs the `attachments` column migration (see below).
7. Calls `persist()` to ensure the file exists on disk even for a freshly created
   database.

### Migrations

#### `attachments` column (v1 → v2)

The `attachments` column was added to the `conversations` table after the initial
release. Existing databases created before this column existed are upgraded at startup:

```
try {
  db.exec("SELECT attachments FROM conversations LIMIT 0");
} catch {
  db.run("ALTER TABLE conversations ADD COLUMN attachments TEXT");
}
```

If the `SELECT` throws (because the column does not exist), the `ALTER TABLE` statement
adds the column. The `LIMIT 0` ensures no rows are scanned; this is purely a schema
probe.

New databases created after this change already include the column via the
`CREATE TABLE IF NOT EXISTS` statement, so the migration is a no-op for them.

---

## Function Reference

### `persist()` _(internal)_

```ts
function persist(): void;
```

**Not exported.** Called internally after every write operation.

- Calls `db.export()` to serialise the in-memory WASM database to a `Uint8Array`.
- Wraps it in a `Buffer` and writes it synchronously to `dbPath` via `writeFileSync`.
- If `db` is `null` (database not yet initialised), returns immediately.

**Side effects:** Rewrites the entire `conversations.db` file on disk.

---

### `initDatabase`

```ts
export async function initDatabase(): Promise<void>;
```

Initialises or loads the database and runs all DDL and migration statements.

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Parameters**   | none                                                                                    |
| **Returns**      | `Promise<void>` — resolves when the database is ready                                   |
| **Side effects** | Sets module-level `db` and `dbPath`; writes `conversations.db` if it does not yet exist |

Must be awaited before any other database function is called. Calling other functions
before `initDatabase` resolves is safe (they guard on `if (!db) return`), but they will
silently do nothing.

---

### `saveConversation`

```ts
export function saveConversation(data: {
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions?: string[];
  attachments?: {
    data: string;
    mimeType: string;
    name: string;
    size: number;
  }[];
}): void;
```

Inserts a completed prompt/response pair into the `conversations` table.

| Parameter                | Required | Description                                                                                      |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `data.promptMessage`     | Yes      | The prompt text shown to the user.                                                               |
| `data.projectName`       | Yes      | Project identifier associated with the prompt.                                                   |
| `data.userResponse`      | Yes      | The user's response text.                                                                        |
| `data.predefinedOptions` | No       | If present and non-empty, serialised to JSON before storage.                                     |
| `data.attachments`       | No       | If present and non-empty, serialised to JSON before storage. An empty array is stored as `NULL`. |

**Side effects:** Inserts one row into `conversations`; calls `persist()`.

---

### `getConversationHistory`

```ts
export function getConversationHistory(limit?: number): ConversationRecord[];
```

Returns conversation records ordered newest-first.

| Parameter | Default | Description                          |
| --------- | ------- | ------------------------------------ |
| `limit`   | `100`   | Maximum number of records to return. |

**Returns:** Array of `ConversationRecord` objects (empty array if the database is not
initialised or the table is empty).

```ts
interface ConversationRecord {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null; // raw JSON string; caller must JSON.parse
  attachments: string | null; // raw JSON string; caller must JSON.parse
  createdAt: string;
}
```

**No side effects.** Does not call `persist()`.

---

### `clearHistory`

```ts
export function clearHistory(): void;
```

Deletes all rows from the `conversations` table. Does not affect session tables.

**Side effects:** Truncates `conversations`; calls `persist()`.

---

### `createSessionChannel`

```ts
export function createSessionChannel(sessionId: string, label?: string): void;
```

Registers a new intensive-chat session. Uses `INSERT OR REPLACE`, so calling it with an
existing `sessionId` overwrites the row (resetting `label` and `created_at`).

| Parameter   | Required | Description                                        |
| ----------- | -------- | -------------------------------------------------- |
| `sessionId` | Yes      | Unique session identifier supplied by the caller.  |
| `label`     | No       | Human-readable label; stored as `NULL` if omitted. |

**Side effects:** Upserts one row into `session_channels`; calls `persist()`.

---

### `getUnsentMessages`

```ts
export function getUnsentMessages(
  sessionId: string,
): { id: number; message: string; createdAt: string }[];
```

Returns all pending (undelivered) messages for a session, ordered by insertion order
(`id ASC`).

| Parameter   | Description        |
| ----------- | ------------------ |
| `sessionId` | Target session ID. |

**Returns:** Array of objects with `id`, `message`, and `createdAt` fields (empty array
if none). The `id` values are used with `markMessagesSent`.

**No side effects.**

---

### `getUnsentCount`

```ts
export function getUnsentCount(sessionId: string): number;
```

Returns the count of undelivered messages for a session.

| Parameter   | Description        |
| ----------- | ------------------ |
| `sessionId` | Target session ID. |

**Returns:** Integer count; `0` if none or database not initialised.

**No side effects.**

---

### `markMessagesSent`

```ts
export function markMessagesSent(ids: number[]): void;
```

Marks a batch of `session_messages` rows as delivered by setting `sent = 1`.

| Parameter | Description                                         |
| --------- | --------------------------------------------------- |
| `ids`     | Array of `session_messages.id` values to mark sent. |

If `ids` is empty, the function returns immediately without executing any SQL.

**Side effects:** Updates rows in `session_messages`; calls `persist()`.

---

### `queueSessionMessage`

```ts
export function queueSessionMessage(sessionId: string, message: string): void;
```

Enqueues an outbound message for delivery to the renderer **and** appends it to the
session history log. Performs two inserts in a single transaction (both within the same
synchronous WASM execution context before `persist()` is called):

1. `INSERT INTO session_messages` with `sent = 0`.
2. `INSERT INTO session_channel_history` with `message_type = 'outbound'`.

| Parameter   | Description                      |
| ----------- | -------------------------------- |
| `sessionId` | Target session ID.               |
| `message`   | Message payload string to queue. |

**Side effects:** Inserts into both `session_messages` and `session_channel_history`;
calls `persist()`.

---

### `appendSessionChannelMessage`

```ts
export function appendSessionChannelMessage(data: {
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound';
  messageText: string;
  attachments?: {
    data: string;
    mimeType: string;
    name: string;
    size: number;
  }[];
}): void;
```

Appends a single message to the session history log without queuing it for delivery.
Used when recording inbound messages from the user (`'answer'`) or prompts sent to the
user (`'question'`).

| Parameter          | Required | Description                                                 |
| ------------------ | -------- | ----------------------------------------------------------- |
| `data.sessionId`   | Yes      | Target session ID.                                          |
| `data.messageType` | Yes      | `'question'`, `'answer'`, or `'outbound'`.                  |
| `data.messageText` | Yes      | Full message content.                                       |
| `data.attachments` | No       | Attachment array; stored as JSON or `NULL` if absent/empty. |

**Side effects:** Inserts one row into `session_channel_history`; calls `persist()`.

---

### `getSessionChannelHistory`

```ts
export function getSessionChannelHistory(
  sessionId: string,
  limit?: number,
): SessionChannelMessageRecord[];
```

Returns the message history for a session ordered by insertion order (`id ASC`).

| Parameter   | Default | Description                          |
| ----------- | ------- | ------------------------------------ |
| `sessionId` | —       | Target session ID.                   |
| `limit`     | `500`   | Maximum number of records to return. |

**Returns:** Array of `SessionChannelMessageRecord` objects (empty array if none).

```ts
interface SessionChannelMessageRecord {
  id: number;
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound';
  messageText: string;
  attachments: string | null; // raw JSON string; caller must JSON.parse
  createdAt: string;
}
```

**No side effects.**

---

### `clearSessionChannelMessages`

```ts
export function clearSessionChannelMessages(sessionId: string): void;
```

Deletes all queued messages and history entries for a session, but **keeps** the
`session_channels` row. The session remains registered; only its message data is removed.

| Parameter   | Description        |
| ----------- | ------------------ |
| `sessionId` | Target session ID. |

**Side effects:** Deletes from `session_messages` and `session_channel_history`; calls
`persist()`.

---

### `deleteSessionChannel`

```ts
export function deleteSessionChannel(sessionId: string): void;
```

Fully removes a session and all associated data. Deletes rows from all three
session-related tables:

1. `DELETE FROM session_messages WHERE session_id = ?`
2. `DELETE FROM session_channel_history WHERE session_id = ?`
3. `DELETE FROM session_channels WHERE session_id = ?`

| Parameter   | Description                              |
| ----------- | ---------------------------------------- |
| `sessionId` | ID of the session to permanently remove. |

**Side effects:** Deletes from three tables; calls `persist()`.

---

### `getActiveSessionChannels`

```ts
export function getActiveSessionChannels(): {
  sessionId: string;
  label: string | null;
  createdAt: string;
}[];
```

Returns all registered session channels ordered by creation time (`created_at ASC`).

**Returns:** Array of objects with `sessionId`, `label`, and `createdAt` (empty array if
none).

**No side effects.**

---

## Data Flow Diagrams

### Single-shot prompt (`request_user_input`)

```
MCP tool call: request_user_input
        │
        ▼
  [Main process handler]
        │
        ├─► appendSessionChannelMessage({ messageType: 'question', ... })
        │         └─ INSERT INTO session_channel_history
        │         └─ persist()
        │
        │   [User responds in UI]
        │
        ├─► saveConversation({ promptMessage, projectName, userResponse, ... })
        │         └─ INSERT INTO conversations
        │         └─ persist()
        │
        └─► appendSessionChannelMessage({ messageType: 'answer', ... })
                  └─ INSERT INTO session_channel_history
                  └─ persist()
```

---

### Intensive chat session lifecycle

```
MCP tool call: start_intensive_chat
        │
        ▼
  createSessionChannel(sessionId, label?)
        └─ INSERT OR REPLACE INTO session_channels
        └─ persist()

        │
        │   [Server sends question]
        ▼
  appendSessionChannelMessage({ messageType: 'question', ... })
        └─ INSERT INTO session_channel_history
        └─ persist()

        │
        │   [Server queues outbound message to renderer]
        ▼
  queueSessionMessage(sessionId, message)
        ├─ INSERT INTO session_messages (sent=0)
        ├─ INSERT INTO session_channel_history (message_type='outbound')
        └─ persist()

        │
        │   [Renderer polls and retrieves pending messages]
        ▼
  getUnsentMessages(sessionId)          ← no persist
  getUnsentCount(sessionId)             ← no persist

        │
        │   [Renderer acknowledges delivery]
        ▼
  markMessagesSent(ids)
        └─ UPDATE session_messages SET sent=1 WHERE id IN (...)
        └─ persist()

        │
        │   [User replies]
        ▼
  appendSessionChannelMessage({ messageType: 'answer', ... })
        └─ INSERT INTO session_channel_history
        └─ persist()

        │
        │   [Session ends]
        ▼
  deleteSessionChannel(sessionId)
        ├─ DELETE FROM session_messages
        ├─ DELETE FROM session_channel_history
        ├─ DELETE FROM session_channels
        └─ persist()
```

---

### App startup

```
Electron app 'ready' event
        │
        ▼
  initDatabase()
        ├─ Resolve dbPath
        ├─ initSqlJs()  [WASM init — async]
        ├─ existsSync(dbPath)?
        │     Yes → readFileSync → new SQL.Database(buffer)
        │     No  → new SQL.Database()
        ├─ CREATE TABLE IF NOT EXISTS conversations
        ├─ Migration: probe attachments column → ALTER TABLE if missing
        ├─ CREATE TABLE IF NOT EXISTS session_channels
        ├─ CREATE TABLE IF NOT EXISTS session_messages
        ├─ CREATE TABLE IF NOT EXISTS session_channel_history
        └─ persist()
```

---

## Immediate-Persist Model: Considerations

### Advantages

- **Crash safety** — every committed write is immediately on disk. There is no window
  where an in-flight transaction is lost due to process termination.
- **Simplicity** — no flush queue, no background timer, no dirty-flag tracking. Every
  function has a clear and deterministic effect on the file.
- **Consistency** — the file on disk always reflects the complete state of the most
  recent successful write.

### Limitations

- **Write amplification** — `db.export()` serialises the full database on every call.
  For the current use case (low-frequency conversational writes) this is not a practical
  concern, but the approach would not suit high-throughput or bulk-insert workloads.
- **Synchronous I/O on the main process** — `writeFileSync` blocks the Node.js event
  loop. For typical database sizes this completes in microseconds, but very large
  databases could introduce measurable latency on the main process.
- **No batching** — functions such as `queueSessionMessage` that perform two inserts
  still call `persist()` once at the end, which is correct. However, if a caller needs
  to perform many independent writes, each will trigger a full serialise-and-write cycle.
  Callers that require bulk operations should accumulate state and call higher-level
  functions rather than invoking low-level functions in a loop.
