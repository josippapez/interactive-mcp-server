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
Records questions sent to the user, answers received, outbound messages
queued by the user, and agent-initiated informational messages.

```sql
CREATE TABLE IF NOT EXISTS session_channel_history (
  id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT     NOT NULL,
  message_type TEXT     NOT NULL,   -- 'question' | 'answer' | 'outbound' | 'agent_message'
  message_text TEXT     NOT NULL,
  attachments  TEXT,                -- JSON array of attachment objects, or NULL
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| Column         | Type     | Nullable | Description                                                                                                                                                          |
| -------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | INTEGER  | No       | Auto-incrementing primary key. Used to preserve insertion order on reads.                                                                                            |
| `session_id`   | TEXT     | No       | Foreign reference to `session_channels.session_id`.                                                                                                                  |
| `message_type` | TEXT     | No       | `'question'` — prompt sent to user; `'answer'` — user reply; `'outbound'` — user-queued message; `'agent_message'` — agent informational message via `send_message`. |
| `message_text` | TEXT     | No       | Full message content.                                                                                                                                                |
| `attachments`  | TEXT     | Yes      | JSON-serialised array of attachment objects (same shape as `conversations.attachments`), or `NULL`.                                                                  |
| `created_at`   | DATETIME | No       | Row creation timestamp.                                                                                                                                              |

---

### `registered_connections`

Persists named agent connections registered via the `register_connection` MCP tool. One row per registered agent. Rows survive app restarts and are used to restore channel identity when an agent reconnects.

Uses a **composite primary key** `(provider_type, provider_session_id)` to isolate connections from different AI providers.

```sql
CREATE TABLE IF NOT EXISTS registered_connections (
  provider_type        TEXT     NOT NULL DEFAULT 'standalone' CHECK(provider_type IN ('opencode', 'copilot-cli', 'claude-sdk', 'standalone')),
  provider_session_id  TEXT     NOT NULL,
  connection_id        TEXT,
  agent_name           TEXT     NOT NULL,
  project_name         TEXT     NOT NULL,
  base_directory       TEXT,
  id_file_path         TEXT     NOT NULL,
  parent_session_id    TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_type, provider_session_id)
);
```

| Column                | Type     | Nullable | Description                                                                                                                                                                                                                     |
| --------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_type`       | TEXT     | No       | Provider type for this connection: `'opencode'`, `'copilot-cli'`, `'claude-sdk'`, or `'standalone'`. Combined with `provider_session_id` forms the composite primary key.                                                       |
| `provider_session_id` | TEXT     | No       | Provider-specific session ID. For `'opencode'`: the OpenCode session ID (e.g., `ses_xxx`). For other providers: the MCP connectionId (UUID). Combined with `provider_type` forms the composite primary key.                     |
| `connection_id`       | TEXT     | Yes      | The MCP transport connectionId (UUID), bound at MCP initialize time. Used as a secondary lookup key.                                                                                                                            |
| `agent_name`          | TEXT     | No       | Human-readable channel name supplied to `register_connection` (e.g. `"Claude Code - my-project"`). **SQLite column name is `agent_name`; the TypeScript `RegisteredConnection` interface exposes this field as `channelName`.** |
| `project_name`        | TEXT     | No       | Project name supplied to `register_connection`.                                                                                                                                                                                 |
| `base_directory`      | TEXT     | Yes      | Absolute path to the agent's working directory, or `NULL` if not supplied. Used primarily for repo-aware features such as file autocomplete, repository-doc indexing, and `find_repo_docs`; it is not the canonical sidebar grouping source for OpenCode sessions. |
| `id_file_path`        | TEXT     | No       | Absolute path to the `/tmp/imcp-agent-<provider>-<name>-<session>.json` ID file written at registration time. Used for recovery after restarts.                                                                                 |
| `parent_session_id`   | TEXT     | Yes      | The OpenCode session ID of the parent session that spawned this agent. Used to nest the subagent channel under its parent in the sidebar. `NULL` if not a subagent.                                                             |
| `created_at`          | DATETIME | No       | Row creation timestamp.                                                                                                                                                                                                         |
| `updated_at`          | DATETIME | No       | Last upsert timestamp (updated on every `register_connection` call for this connection).                                                                                                                                        |

#### Provider types

| Provider Type | Description                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `opencode`    | OpenCode sessions with session hierarchy and context injection support |
| `copilot-cli` | GitHub Copilot CLI connections                                         |
| `claude-sdk`  | Anthropic Claude SDK connections                                       |
| `standalone`  | Direct MCP connections without provider-specific features (default)    |

#### `provider_session_id` lifecycle

- **Set** during `register_connection`: For OpenCode providers, this is the session ID passed via `openCodeSessionId`. For other providers, this is typically the MCP `connectionId`.
- **Used** as the primary lookup key (combined with `provider_type`) for all connection operations.
- **Backwards compatibility**: The `openCodeSessionId` field in the TypeScript interface mirrors `providerSessionId` for compatibility with existing code.

#### `base_directory` preservation

For OpenCode sessions, `base_directory` is preserved across partial re-registration. If a later `register_connection` call omits `baseDirectory`, the existing stored value is retained rather than cleared. This prevents repo-aware features from losing context when an agent re-registers without repeating its directory metadata.

#### `parent_session_id` lifecycle

- **Set** during `register_connection`: after `provider_session_id` is resolved, the tool looks up the parent session for nested subagents.
- **`NULL`** for top-level agents that were not spawned by another session.
- **Used** by the renderer's `ChannelSidebar` to build the parent-child tree view.

---

### `skills_and_instructions`

Persists reusable skills and instructions that are automatically injected into every new agent session at `register_connection` time. Managed via the `manage_skills_and_instructions` MCP tool.

```sql
CREATE TABLE IF NOT EXISTS skills_and_instructions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  type        TEXT    NOT NULL CHECK(type IN ('skill', 'instruction')),
  description TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  category    TEXT,
  tags        TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| Column        | Type     | Nullable | Description                                                                                            |
| ------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `id`          | INTEGER  | No       | Auto-incrementing primary key.                                                                         |
| `name`        | TEXT     | No       | Unique name/identifier for the entry. Used as the primary lookup key.                                  |
| `type`        | TEXT     | No       | Either `'skill'` (reusable workflow/recipe) or `'instruction'` (behavioural rule/policy).              |
| `description` | TEXT     | No       | Short summary shown in `list` action results.                                                          |
| `content`     | TEXT     | No       | Full Markdown body of the skill or instruction.                                                        |
| `category`    | TEXT     | Yes      | Category for organizing entries (e.g., "Code Review", "Testing", "Documentation"). Used for filtering. |
| `tags`        | TEXT     | Yes      | JSON-serialised `string[]` of tags for categorization (e.g., `["typescript", "react"]`), or `NULL`.    |
| `enabled`     | INTEGER  | No       | Boolean encoded as int: `1` = enabled (injected into sessions), `0` = disabled. Default is `1`.        |
| `is_builtin`  | INTEGER  | No       | Boolean encoded as int: `1` = built-in template shipped with app, `0` = user-created. Default is `0`.  |
| `created_at`  | DATETIME | No       | Row creation timestamp.                                                                                |
| `updated_at`  | DATETIME | No       | Last upsert timestamp. Updated on every `register` call for a name that already exists in the table.   |

#### TypeScript interface

```ts
export interface SkillOrInstruction {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category: string | null;
  tags: string[] | null;
  enabled: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

### `pending_context_injections`

Queues noReply context injections for delivery to agents (used primarily for Copilot CLI / standalone mode). Injections are claimed atomically and delivered via the `poll_context_injections` MCP tool or auto-prepended to `request_user_input` responses.

```sql
CREATE TABLE IF NOT EXISTS pending_context_injections (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT     NOT NULL,
  source        TEXT     NOT NULL DEFAULT 'manual',
  replace_key   TEXT,
  payload       TEXT     NOT NULL,
  claimed       INTEGER  DEFAULT 0,
  delivered     INTEGER  DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pci_connection_delivered
  ON pending_context_injections (connection_id, delivered);
```

| Column          | Type     | Nullable | Description                                                                                                         |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`            | INTEGER  | No       | Auto-incrementing primary key.                                                                                      |
| `connection_id` | TEXT     | No       | The MCP connectionId this injection is destined for.                                                                |
| `source`        | TEXT     | No       | Source identifier for the injection (e.g., `'manual'`, `'docs'`, `'skills'`). Default is `'manual'`.                |
| `replace_key`   | TEXT     | Yes      | When provided, existing undelivered injections with the same (connectionId, replaceKey) are replaced (latest wins). |
| `payload`       | TEXT     | No       | The injection payload content (typically Markdown context to inject).                                               |
| `claimed`       | INTEGER  | No       | Boolean encoded as int: `1` = claimed by a poll operation, `0` = unclaimed.                                         |
| `delivered`     | INTEGER  | No       | Boolean encoded as int: `1` = successfully delivered to agent, `0` = pending delivery.                              |
| `created_at`    | DATETIME | No       | Row creation timestamp.                                                                                             |

#### TypeScript interface

```ts
export interface ContextInjection {
  id: number;
  source: string;
  payload: string;
  createdAt: string;
}
```

---

## Initialization and Schema Versioning

### `initDatabase(): Promise<void>`

Called once during application startup (Electron `main` process). Performs the following
steps in order:

1. Resolves `dbPath` to `{userData}/conversations.db`.
2. Initialises the sql.js WASM engine via `initSqlJs()`.
3. If `dbPath` exists on disk, reads the file into a `Buffer` and passes it to
   `new SQL.Database(buffer)` to restore the existing database.
4. If `dbPath` does not exist, creates a fresh in-memory database with
   `new SQL.Database()`.
5. Reads `PRAGMA user_version` from the database.
6. If the stored version does **not** match the expected `SCHEMA_VERSION` constant
   (currently `9`), the database is wiped and recreated (see below).
7. Runs `CREATE TABLE IF NOT EXISTS` for all seven tables with the full column set
   baked in — no incremental `ALTER TABLE` migrations.
8. Writes `PRAGMA user_version = {SCHEMA_VERSION}`.
9. Calls `persist()` to ensure the file exists on disk even for a freshly created
   database.

### Schema versioning strategy (`PRAGMA user_version`)

The database uses SQLite's `PRAGMA user_version` as a simple schema version tag. The
expected version is defined as `const SCHEMA_VERSION = 9` at the top of `database.ts`.

On startup, `initDatabase()` compares the stored version against `SCHEMA_VERSION`:

- **Match** — the schema is compatible; proceed normally.
- **Mismatch** (including version `0` from a legacy database) — the in-memory database
  is closed and a fresh `new SQL.Database()` is created. All tables are recreated with
  the current column definitions. The old file on disk is overwritten on the next
  `persist()` call.

This approach replaces the previous incremental migration system (v1-v7 `ALTER TABLE`
blocks) which had accumulated data-destructive side effects. The trade-off is that a
schema version bump will wipe existing data, which is acceptable for the current use
case (session metadata and conversation history that is rebuilt on agent reconnection).

### Adding new columns in the future

To add a new column:

1. Add the column to the relevant `CREATE TABLE IF NOT EXISTS` statement.
2. Bump `SCHEMA_VERSION` (e.g. `1` → `2`).
3. On the next startup, existing databases with version `1` will be wiped and recreated
   with the new schema.

No `ALTER TABLE` migration code is needed.

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

### `getDbInstance`

```ts
export function getDbInstance(): SqlJsDatabase | null;
```

Returns the internal sql.js database reference for modules that need direct SQL access.

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| **Returns** | The sql.js `Database` instance, or `null` if not initialised |

**No side effects.**

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

### `resetDatabase`

```ts
export function resetDatabase(): {
  ok: boolean;
  clearedTables: string[];
  removedIdFiles: number;
};
```

Resets the entire database by clearing all tables and removing ID files from disk. Used for full app reset.

**Returns:** Object with:

- `ok`: `true` if successful, `false` if database not initialised.
- `clearedTables`: Array of table names that were cleared.
- `removedIdFiles`: Count of ID files successfully removed from disk.

**Side effects:** Deletes all rows from all tables; removes ID files from `/tmp`; calls `persist()`.

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
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
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
Used when recording inbound messages from the user (`'answer'`), prompts sent to the
user (`'question'`), or agent informational messages (`'agent_message'`).

| Parameter          | Required | Description                                                   |
| ------------------ | -------- | ------------------------------------------------------------- |
| `data.sessionId`   | Yes      | Target session ID.                                            |
| `data.messageType` | Yes      | `'question'`, `'answer'`, `'outbound'`, or `'agent_message'`. |
| `data.messageText` | Yes      | Full message content.                                         |
| `data.attachments` | No       | Attachment array; stored as JSON or `NULL` if absent/empty.   |

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
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
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

### `upsertSkillOrInstruction`

```ts
export function upsertSkillOrInstruction(data: {
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category?: string | null;
  tags?: string[] | null;
}): SkillOrInstruction | null;
```

Creates a new `skills_and_instructions` row, or updates the existing row with the same `name`. On conflict the `type`, `description`, `content`, `category`, `tags`, and `updated_at` columns are overwritten; `created_at`, `enabled`, and `is_builtin` are preserved.

| Parameter          | Required | Description                                                |
| ------------------ | -------- | ---------------------------------------------------------- |
| `data.name`        | Yes      | Unique name/identifier for the entry.                      |
| `data.type`        | Yes      | `'skill'` or `'instruction'`.                              |
| `data.description` | Yes      | Short summary shown in list results.                       |
| `data.content`     | Yes      | Full Markdown body.                                        |
| `data.category`    | No       | Category for organizing entries (e.g., "Code Review").     |
| `data.tags`        | No       | Array of tags for categorization (e.g., `["typescript"]`). |

**Returns:** The saved `SkillOrInstruction` record (fetched via `getSkillOrInstructionByName` after the upsert), or `null` if the database is not initialised.

**Side effects:** Upserts one row into `skills_and_instructions`; calls `persist()`.

---

### `listSkillsAndInstructions`

```ts
export function listSkillsAndInstructions(
  filterType?: 'skill' | 'instruction',
  filterCategory?: string,
): SkillOrInstruction[];
```

Returns all rows from `skills_and_instructions`, ordered alphabetically by `name`.

| Parameter        | Default | Description                                                   |
| ---------------- | ------- | ------------------------------------------------------------- |
| `filterType`     | —       | If provided, only rows whose `type` matches are returned.     |
| `filterCategory` | —       | If provided, only rows whose `category` matches are returned. |

**Returns:** Array of `SkillOrInstruction` objects (empty array if none or database not initialised).

**No side effects.**

---

### `getSkillOrInstructionByName`

```ts
export function getSkillOrInstructionByName(
  name: string,
): SkillOrInstruction | null;
```

Looks up a single row by its unique `name`.

| Parameter | Description            |
| --------- | ---------------------- |
| `name`    | Exact name to look up. |

**Returns:** The matching `SkillOrInstruction`, or `null` if not found or database not initialised.

**No side effects.**

---

### `deleteSkillOrInstruction`

```ts
export function deleteSkillOrInstruction(name: string): boolean;
```

Deletes the row with the given `name` from `skills_and_instructions`.

| Parameter | Description           |
| --------- | --------------------- |
| `name`    | Exact name to delete. |

**Returns:** `true` if a row was found and deleted; `false` if no matching row existed or the database is not initialised.

**Side effects:** Deletes one row from `skills_and_instructions` if it exists; calls `persist()`.

---

### `toggleSkillOrInstructionEnabled`

```ts
export function toggleSkillOrInstructionEnabled(
  name: string,
  enabled: boolean,
): SkillOrInstruction | null;
```

Toggles the enabled status of a skill or instruction.

| Parameter | Description                            |
| --------- | -------------------------------------- |
| `name`    | Exact name of the entry to update.     |
| `enabled` | New enabled state (`true` or `false`). |

**Returns:** The updated `SkillOrInstruction` record, or `null` if not found or database not initialised.

**Side effects:** Updates one row in `skills_and_instructions`; calls `persist()`.

---

### `duplicateSkillOrInstruction`

```ts
export function duplicateSkillOrInstruction(
  name: string,
): SkillOrInstruction | null;
```

Duplicates a skill or instruction with a new name. The new name will be `"{original-name}-copy"` or `"{original-name}-copy-2"`, etc.

| Parameter | Description                           |
| --------- | ------------------------------------- |
| `name`    | Exact name of the entry to duplicate. |

**Returns:** The newly created `SkillOrInstruction` record, or `null` if the original doesn't exist or database not initialised.

**Side effects:** Inserts one row into `skills_and_instructions`; calls `persist()`.

---

### `seedBuiltinTemplates`

```ts
export function seedBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): number;
```

Seeds built-in templates into the database. Only inserts templates that don't already exist (by name).

| Parameter   | Description                        |
| ----------- | ---------------------------------- |
| `templates` | Array of template objects to seed. |

**Returns:** The count of templates that were newly inserted.

**Side effects:** Inserts rows into `skills_and_instructions` for new templates; calls `persist()`.

---

### `resetBuiltinTemplates`

```ts
export function resetBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): number;
```

Resets built-in templates to their default content. Re-inserts any missing built-in templates and updates existing ones to match the original content.

| Parameter   | Description                            |
| ----------- | -------------------------------------- |
| `templates` | Array of template objects to reset to. |

**Returns:** The count of templates that were reset or inserted.

**Side effects:** Updates/inserts rows in `skills_and_instructions`; calls `persist()`.

---

### `getMissingBuiltinCount`

```ts
export function getMissingBuiltinCount(templateNames: string[]): number;
```

Gets count of missing built-in templates.

| Parameter       | Description                           |
| --------------- | ------------------------------------- |
| `templateNames` | Array of template names to check for. |

**Returns:** How many of the provided template names don't exist in the database.

**No side effects.**

---

## Context Injection Functions

### `upsertContextInjection`

```ts
export function upsertContextInjection(
  connectionId: string,
  payload: string,
  source?: string,
  replaceKey?: string,
): void;
```

Queues a noReply context injection for delivery to a standalone (Copilot CLI) agent. When `replaceKey` is provided, any existing undelivered injection with the same (connectionId, replaceKey) is replaced — useful for doc context where latest wins.

| Parameter      | Default    | Description                                                           |
| -------------- | ---------- | --------------------------------------------------------------------- |
| `connectionId` | —          | The MCP connectionId for the target agent.                            |
| `payload`      | —          | The injection payload content to queue.                               |
| `source`       | `'manual'` | Source identifier for the injection.                                  |
| `replaceKey`   | —          | Optional key; if provided, replaces existing injection with same key. |

**Side effects:** Inserts (or replaces) a row in `pending_context_injections`; calls `persist()`.

---

### `claimContextInjections`

```ts
export function claimContextInjections(
  connectionId: string,
): ContextInjection[];
```

Atomically claims and returns all undelivered injections for a connection. Marks them as delivered immediately. Safe in single-threaded Node.js/sql.js.

| Parameter      | Description                                   |
| -------------- | --------------------------------------------- |
| `connectionId` | The MCP connectionId to claim injections for. |

**Returns:** Array of `ContextInjection` objects (empty array if none).

**Side effects:** Updates `delivered = 1` on claimed rows; calls `persist()`.

---

### `deleteContextInjectionsForConnection`

```ts
export function deleteContextInjectionsForConnection(
  connectionId: string,
): void;
```

Removes all context injections (delivered or not) for a connection.

| Parameter      | Description                                    |
| -------------- | ---------------------------------------------- |
| `connectionId` | The MCP connectionId to delete injections for. |

**Side effects:** Deletes rows from `pending_context_injections`; calls `persist()`.

---

## Registered Connection Functions

### `agentIdFilePath`

```ts
export function agentIdFilePath(
  channelName: string,
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): string;
```

Returns the path for a per-agent connection ID file in `/tmp`. Includes provider type to prevent collisions between providers.

| Parameter           | Default        | Description                   |
| ------------------- | -------------- | ----------------------------- |
| `channelName`       | —              | Human-readable channel name.  |
| `providerSessionId` | —              | Provider-specific session ID. |
| `providerType`      | `'standalone'` | Provider type.                |

**Returns:** Absolute path like `/tmp/imcp-agent-<provider>-<name>-<session>.json`.

**No side effects.**

---

### `upsertRegisteredConnection`

```ts
export function upsertRegisteredConnection(data: {
  providerSessionId?: string;
  openCodeSessionId?: string; // deprecated, use providerSessionId
  channelName: string;
  projectName: string;
  connectionId?: string | null;
  baseDirectory?: string;
  parentSessionId?: string | null;
  providerType?: RegisteredConnection['providerType'];
}): string;
```

Upserts a registered connection. Writes the ID file to /tmp and persists the record to the database.

Uses composite primary key `(provider_type, provider_session_id)`. This ensures connections from different providers cannot overwrite each other.

| Parameter           | Required | Description                                                             |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `providerSessionId` | Yes\*    | Provider-specific session ID. For OpenCode, use the session ID.         |
| `openCodeSessionId` | No       | **Deprecated.** Falls back to this if `providerSessionId` not provided. |
| `channelName`       | Yes      | Human-readable channel name.                                            |
| `projectName`       | Yes      | Project name.                                                           |
| `connectionId`      | No       | MCP transport connectionId (UUID).                                      |
| `baseDirectory`     | No       | Absolute path to working directory.                                     |
| `parentSessionId`   | No       | Parent session ID for subagents.                                        |
| `providerType`      | No       | Provider type. Defaults to `'standalone'`.                              |

\* Either `providerSessionId` or `openCodeSessionId` must be provided.

**Returns:** The path to the ID file written to `/tmp`.

**Side effects:** Writes ID file to disk; upserts row in `registered_connections`; calls `persist()`.

---

### `getAllRegisteredConnections`

```ts
export function getAllRegisteredConnections(): RegisteredConnection[];
```

Returns all registered connections, ordered by creation time.

**Returns:** Array of `RegisteredConnection` objects (empty array if none).

**No side effects.**

---

### `getRegisteredConnection`

```ts
export function getRegisteredConnection(
  connectionId: string,
): RegisteredConnection | null;
```

Looks up a registered connection by transport connectionId (secondary lookup). Searches the `connection_id` column.

| Parameter      | Description                 |
| -------------- | --------------------------- |
| `connectionId` | MCP transport connectionId. |

**Returns:** The matching `RegisteredConnection`, or `null` if not found.

**No side effects.**

---

### `getRegisteredConnectionBySessionId`

```ts
export function getRegisteredConnectionBySessionId(
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): RegisteredConnection | null;
```

Primary lookup: find a registered connection by its composite key (providerType, providerSessionId).

| Parameter           | Default      | Description                   |
| ------------------- | ------------ | ----------------------------- |
| `providerSessionId` | —            | Provider-specific session ID. |
| `providerType`      | `'opencode'` | Provider type.                |

**Returns:** The matching `RegisteredConnection`, or `null` if not found.

**No side effects.**

---

### `getRegisteredConnectionByOpenCodeSessionId` _(deprecated)_

```ts
export function getRegisteredConnectionByOpenCodeSessionId(
  openCodeSessionId: string,
): RegisteredConnection | null;
```

**Deprecated.** Use `getRegisteredConnectionBySessionId` with explicit `providerType` instead.

Legacy lookup that searches across all provider types but only returns the first match.

**No side effects.**

---

### `updateConnectionId`

```ts
export function updateConnectionId(
  providerSessionId: string,
  connectionId: string,
  providerType?: RegisteredConnection['providerType'],
): void;
```

Binds a transport connectionId to an existing registered connection row. Called at MCP initialize time when the SSE row already exists.

| Parameter           | Default      | Description                   |
| ------------------- | ------------ | ----------------------------- |
| `providerSessionId` | —            | Provider-specific session ID. |
| `connectionId`      | —            | MCP transport connectionId.   |
| `providerType`      | `'opencode'` | Provider type.                |

**Side effects:** Updates row in `registered_connections`; calls `persist()`.

---

### `getRegisteredConnectionByName`

```ts
export function getRegisteredConnectionByName(
  channelName: string,
): RegisteredConnection | null;
```

Looks up a registered connection by channel name. Returns the most recently updated match.

| Parameter     | Description                  |
| ------------- | ---------------------------- |
| `channelName` | Human-readable channel name. |

**Returns:** The matching `RegisteredConnection`, or `null` if not found.

**No side effects.**

---

### `isProviderSessionClaimed`

```ts
export function isProviderSessionClaimed(
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): boolean;
```

Returns true if the given provider session already has a registered connection row.

| Parameter           | Default      | Description                   |
| ------------------- | ------------ | ----------------------------- |
| `providerSessionId` | —            | Provider-specific session ID. |
| `providerType`      | `'opencode'` | Provider type.                |

**Returns:** `true` if claimed, `false` otherwise.

**No side effects.**

---

### `isOpenCodeSessionClaimed` _(deprecated)_

```ts
export function isOpenCodeSessionClaimed(openCodeSessionId: string): boolean;
```

**Deprecated.** Use `isProviderSessionClaimed` with `providerType` instead.

---

### `getRegisteredConnectionsByProvider`

```ts
export function getRegisteredConnectionsByProvider(
  providerType: RegisteredConnection['providerType'],
): RegisteredConnection[];
```

Returns all registered connections filtered by provider type.

| Parameter      | Description                 |
| -------------- | --------------------------- |
| `providerType` | Provider type to filter by. |

**Returns:** Array of `RegisteredConnection` objects (empty array if none).

**No side effects.**

---

### `updateConnectionProviderSession`

```ts
export function updateConnectionProviderSession(
  connectionId: string,
  newProviderSessionId: string,
  newProviderType?: RegisteredConnection['providerType'],
): void;
```

Updates the provider session ID on an existing registered connection. Used by the SSE auto-bind logic to attach a just-created OpenCode child session to the MCP connection.

With the composite PK, this creates a new row with the new session ID and deletes the old row (if it was a temporary connectionId-based row).

| Parameter              | Default      | Description                         |
| ---------------------- | ------------ | ----------------------------------- |
| `connectionId`         | —            | MCP transport connectionId to find. |
| `newProviderSessionId` | —            | New provider session ID.            |
| `newProviderType`      | `'opencode'` | Provider type for the new row.      |

**Side effects:** May delete old row and insert new row; calls `persist()`.

---

### `updateConnectionOpenCodeSession` _(deprecated)_

```ts
export function updateConnectionOpenCodeSession(
  connectionId: string,
  openCodeSessionId: string,
): void;
```

**Deprecated.** Use `updateConnectionProviderSession` instead.

---

### `deleteRegisteredConnection`

```ts
export function deleteRegisteredConnection(
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): void;
```

Deletes a registered connection from the DB and removes the ID file from disk.

| Parameter           | Default      | Description                   |
| ------------------- | ------------ | ----------------------------- |
| `providerSessionId` | —            | Provider-specific session ID. |
| `providerType`      | `'opencode'` | Provider type.                |

**Side effects:** Removes ID file from disk; deletes row from `registered_connections`; calls `persist()`.

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
        ├─ PRAGMA user_version → storedVersion
        ├─ storedVersion !== SCHEMA_VERSION?
        │     Yes → close db → new SQL.Database() (fresh)
        │     No  → continue
        ├─ CREATE TABLE IF NOT EXISTS conversations
        ├─ CREATE TABLE IF NOT EXISTS session_channels
        ├─ CREATE TABLE IF NOT EXISTS session_messages
        ├─ CREATE TABLE IF NOT EXISTS session_channel_history
        ├─ CREATE TABLE IF NOT EXISTS skills_and_instructions
        ├─ CREATE TABLE IF NOT EXISTS registered_connections
        ├─ CREATE TABLE IF NOT EXISTS pending_context_injections
        ├─ CREATE INDEX IF NOT EXISTS idx_pci_connection_delivered
        ├─ PRAGMA user_version = SCHEMA_VERSION
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
