# Database Layer — Interactive MCP Desktop

## Overview

The desktop application stores conversation history, provider session metadata,
context-injection queues, skills/instructions, pinned projects, and persistent
memories in a local SQLite database managed by
**[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)**.

`better-sqlite3` is a synchronous native SQLite binding. Calls such as
`db.prepare(...).run()`, `db.prepare(...).get()`, `db.prepare(...).all()`, and
`db.transaction(fn)()` execute in-process and return only after SQLite has
completed the operation. There is no application-level async wrapper in
`desktop/src/main/utility/backend/database.ts`; callers use the exported
functions synchronously after `initDatabase()` has opened the file.

The database code lives in the utility backend at
`desktop/src/main/utility/backend/database.ts`. Main-side code reaches it through
the utility bridge described in [ARCHITECTURE.md](./ARCHITECTURE.md) and the MCP
tooling described in [MCP-SERVER.md](./MCP-SERVER.md). Renderer-facing entry
points that expose database-backed state are documented in
[IPC-API.md](./IPC-API.md).

### Engine and packaging requirements

`better-sqlite3` ships a native `.node` binding. The desktop package depends on
`better-sqlite3` `^12.9.0` and rebuilds it against Electron's ABI with the
`rebuild:electron` script:

```json
{
  "rebuild:electron": "electron-rebuild -w better-sqlite3",
  "postinstall": "electron-rebuild -w better-sqlite3"
}
```

Packaging commands run the rebuild before `electron-vite build` and
`electron-builder`. The build configuration also keeps the native binding outside
the archive so it is loadable at runtime. See [BUILD-PACKAGING.md](./BUILD-PACKAGING.md)
for the dependency table and packaging flow.

### Persistence model

SQLite writes directly to `{userData}/conversations.db`; the database module does
not maintain a separate in-memory copy and does not require explicit persist
calls after mutations.

Startup applies these pragmas immediately after opening the file:

```ts
db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
```

Implications:

- **Synchronous writes:** mutation helpers return after the `better-sqlite3`
  statement finishes.
- **WAL journal mode:** SQLite may create sidecar `conversations.db-wal` and
  `conversations.db-shm` files. This supports concurrent readers with a single
  writer and fast commits.
- **`synchronous=NORMAL`:** SQLite syncs at checkpoint boundaries rather than on
  every commit, which is the mode currently selected by the code.
- **Foreign keys enabled:** `PRAGMA foreign_keys = ON` is set defensively even
  though the current schema does not declare foreign-key constraints.
- **Compatibility flush hooks are no-ops:** `flushPersistNow()` and
  `__cancelPendingPersistForTests()` remain exported for existing callers, but
  there is no pending application-level flush queue.

### Historical note

Earlier revisions used `sql.js`, a WebAssembly SQLite build, with `initSqlJs()`
and explicit `db.export()` / `writeFileSync` persistence. That design is gone;
the Phase C migration moved the database to `better-sqlite3` native SQLite.

---

## File Location

```text
{app.getPath('userData')}/conversations.db
```

`initDatabase(userDataPath, overridePath?)` sets the module-level `dbPath` to
`overridePath` when provided, otherwise to `join(userDataPath, 'conversations.db')`.
Production callers pass Electron's `app.getPath('userData')` as `userDataPath`.

| Platform | Typical `userData` path                     |
| -------- | ------------------------------------------- |
| macOS    | `~/Library/Application Support/<app-name>/` |
| Windows  | `%APPDATA%\<app-name>\`                     |
| Linux    | `~/.config/<app-name>/`                     |

The database file is opened synchronously with `new Database(dbPath)`.

---

## Initialization and Schema Versioning

### Current schema version

`SCHEMA_VERSION` is currently **15**.

The database stores the applied schema version in `PRAGMA user_version`. On
startup, `initDatabase()` compares the stored version with `SCHEMA_VERSION`:

```ts
const storedVersion = getSchemaVersion();
if (storedVersion !== SCHEMA_VERSION) {
  const preservedSkills = preserveSkillsAndInstructions();
  const preservedMemories = preserveMemories();
  dropAllTables();
  createTables();
  restoreSkillsAndInstructions(preservedSkills);
  restoreMemories(preservedMemories);
  setSchemaVersion(SCHEMA_VERSION);
} else {
  createTables();
}
```

The project intentionally avoids incremental migration scripts. A schema-version
mismatch drops known tables and recreates them with the final DDL. Only data with
explicit preserve/restore helpers survives the wipe.

### Preserve/restore pattern during schema bumps

Before dropping tables, the code snapshots selected user-authored rows with
best-effort reads. If a table does not exist yet, or the snapshot read fails, the
preserve helper returns an empty array and startup continues.

Currently preserved across schema bumps:

| Data set                  | Preserve helper                   | Restore helper                   | Restore behavior                                                                                                                                                                             |
| ------------------------- | --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills_and_instructions` | `preserveSkillsAndInstructions()` | `restoreSkillsAndInstructions()` | Re-inserts `name`, `type`, `description`, `content`, `category`, `tags`, `enabled`, `is_builtin`, timestamps, and `delivery_mode`; restores `folder_id` as `NULL` and `scope` as `'global'`. |
| `memories`                | `preserveMemories()`              | `restoreMemories()`              | Re-inserts `scope`, `project_path`, `content`, `created_at`, and `updated_at`.                                                                                                               |

All other tables are recreated empty on a version mismatch. This includes
session/channel tables, registered connections, context-injection queues, pinned
projects, folder rows, and per-session opt-in/mute rows.

### Initialization sequence

```text
Application startup
        |
        v
initDatabase(userDataPath, overridePath?)
        |
        v
dbPath = overridePath ?? join(userDataPath, 'conversations.db')
        |
        v
db = new Database(dbPath)
        |
        v
Apply PRAGMAs: WAL, synchronous=NORMAL, foreign_keys=ON
        |
        v
Read PRAGMA user_version
        |
        +-- version mismatch --> preserve selected rows
        |                       drop known tables
        |                       create current tables
        |                       restore selected rows
        |                       set PRAGMA user_version = 15
        |
        +-- version match ----> create current tables idempotently
        |
        v
Clean invalid pinned-project rows with empty path/name
```

---

## Schema

Every table below is created by `createTables()` in
`desktop/src/main/utility/backend/database.ts`.

### `conversations`

Stores single-shot prompt/response exchanges.

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_message     TEXT    NOT NULL,
  project_name       TEXT    NOT NULL,
  user_response      TEXT    NOT NULL,
  predefined_options TEXT,
  attachments        TEXT,
  created_at         TEXT    DEFAULT (datetime('now'))
)
```

| Column               | Meaning                                           |
| -------------------- | ------------------------------------------------- |
| `id`                 | Autoincrement primary key.                        |
| `prompt_message`     | Prompt text shown to the user.                    |
| `project_name`       | Project associated with the prompt.               |
| `user_response`      | User response text.                               |
| `predefined_options` | JSON-encoded option labels, or `NULL`.            |
| `attachments`        | JSON-encoded attachment metadata/data, or `NULL`. |
| `created_at`         | Creation timestamp from SQLite.                   |

### `session_channels`

Tracks active channel IDs and optional labels.

```sql
CREATE TABLE IF NOT EXISTS session_channels (
  session_id TEXT     PRIMARY KEY,
  label      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `session_messages`

Queue for outbound messages that still need delivery to a session.

```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  message    TEXT     NOT NULL,
  sent       INTEGER  DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

`sent=0` means the message is still pending. `markMessagesSent(ids)` sets
`sent=1` for delivered rows.

### `session_channel_history`

Append-only-ish history of messages associated with a session channel.

```sql
CREATE TABLE IF NOT EXISTS session_channel_history (
  id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT     NOT NULL,
  message_type TEXT     NOT NULL,
  message_text TEXT     NOT NULL,
  attachments  TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

`message_type` is handled in TypeScript as one of:

- `'question'`
- `'answer'`
- `'outbound'`
- `'agent_message'`

### `skills_and_instructions`

Catalog of user-authored and built-in skills/instructions. Entries can be global
or session-scoped and instructions can use `always` or `catalog` delivery mode.

```sql
CREATE TABLE IF NOT EXISTS skills_and_instructions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  type          TEXT    NOT NULL CHECK(type IN ('skill', 'instruction')),
  description   TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  category      TEXT,
  tags          TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  folder_id     INTEGER,
  scope         TEXT    NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'session-scoped')),
  delivery_mode TEXT    NOT NULL DEFAULT 'always' CHECK(delivery_mode IN ('always', 'catalog'))
)
```

Important semantics:

- `name` is the stable unique key used by CRUD helpers.
- `tags` is JSON text representing `string[]`, or `NULL`.
- `enabled=0` entries are retained but excluded by injection callers.
- `is_builtin=1` marks seeded templates.
- `folder_id` is organizational only; the schema does not enforce a foreign key.
- `scope='global'` means the entry is eligible for every session unless muted.
- `scope='session-scoped'` means the entry is injected only when the session has
  an opt-in row in `session_scoped_entries`.
- `delivery_mode` applies to instructions: `always` injects content into the
  startup reminder, while `catalog` leaves the content discoverable through the
  catalog path.

`ALWAYS_INSTRUCTION_SOFT_LIMIT` is `8_000`; `getAlwaysInstructionWarning(content)`
returns a warning string when an always-mode instruction exceeds that length.

### `folders`

Flat organizational folders for skills/instructions.

```sql
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Folders have no injection semantics. Deleting a folder nulls matching
`skills_and_instructions.folder_id` values and does not delete entries.

### `session_scoped_entries`

Per-session opt-in set for entries whose `scope` is `'session-scoped'`.

```sql
CREATE TABLE IF NOT EXISTS session_scoped_entries (
  provider_type       TEXT     NOT NULL,
  provider_session_id TEXT     NOT NULL,
  entry_name          TEXT     NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_type, provider_session_id, entry_name)
)

CREATE INDEX IF NOT EXISTS idx_sse_entry_name
  ON session_scoped_entries (entry_name)
```

Rows are keyed by provider identity, not transient transport identity, so opt-ins
survive reconnects that create a new `connection_id`.

### `session_muted_entries`

Per-session mute set for global entries.

```sql
CREATE TABLE IF NOT EXISTS session_muted_entries (
  provider_type       TEXT     NOT NULL,
  provider_session_id TEXT     NOT NULL,
  entry_name          TEXT     NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_type, provider_session_id, entry_name)
)

CREATE INDEX IF NOT EXISTS idx_sme_entry_name
  ON session_muted_entries (entry_name)
```

A row means: do not inject the named global entry for this provider session.

### `registered_connections`

Canonical provider-session registry. This is the source of truth for associating
provider session IDs, MCP transport handles, project folders, and temporary ID
files.

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
)
```

Key points:

- `(provider_type, provider_session_id)` is the composite primary key.
- `provider_session_id` is canonical within a provider. For OpenCode it is the
  OpenCode `ses_...` ID; for non-OpenCode providers it is the session identifier
  supplied at registration.
- `connection_id` is a nullable MCP transport handle, not the canonical identity.
- `base_directory` is used for project-aware memory and repository-context
  injection.
- `id_file_path` points to a JSON file under the OS temp directory generated by
  `agentIdFilePath()`.

For the provider/session behavior around MCP registration and auto-registration,
see [MCP-SERVER.md](./MCP-SERVER.md).

### `pending_context_injections`

Queue for no-reply context payloads that should be delivered to provider sessions.

```sql
CREATE TABLE IF NOT EXISTS pending_context_injections (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  provider_type       TEXT     NOT NULL DEFAULT 'standalone',
  provider_session_id TEXT     NOT NULL,
  source              TEXT     NOT NULL DEFAULT 'manual',
  replace_key         TEXT,
  payload             TEXT     NOT NULL,
  claimed             INTEGER  DEFAULT 0,
  delivered           INTEGER  DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
)

CREATE INDEX IF NOT EXISTS idx_pci_session_delivered
  ON pending_context_injections (provider_type, provider_session_id, delivered)
```

`upsertContextInjection()` optionally deletes an existing undelivered row with the
same `(provider_type, provider_session_id, replace_key)` before inserting the new
payload. `claimContextInjections()` selects undelivered rows in `id ASC` order and
marks them delivered in the same transaction.

`claimed` exists in the table but the current claim helper only updates
`delivered`.

### `pinned_projects`

Manually pinned project folders shown in the sidebar even when no sessions exist.

```sql
CREATE TABLE IF NOT EXISTS pinned_projects (
  path        TEXT     PRIMARY KEY,
  name        TEXT     NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Startup deletes rows where `TRIM(path) = '' OR TRIM(name) = ''` as a one-shot
cleanup for invalid rows written by older builds.

### `memories`

Persistent memory notes injected into startup context. This table was added in
schema version 15.

```sql
CREATE TABLE IF NOT EXISTS memories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT    NOT NULL CHECK(scope IN ('global', 'project')),
  project_path TEXT,
  content      TEXT    NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope = 'global' AND project_path IS NULL) OR
         (scope = 'project' AND project_path IS NOT NULL))
)

CREATE INDEX IF NOT EXISTS idx_memories_scope_project
  ON memories(scope, project_path)
```

Scope semantics:

- `scope='global'` requires `project_path IS NULL` and is injected into every
  session.
- `scope='project'` requires `project_path IS NOT NULL` and is injected only when
  the session `baseDirectory` exactly matches `project_path`.
- `listMemories({ projectPath })` returns global memories plus project memories
  for that exact project path. This is the normal injection query.
- `listMemories({ scope: 'global' })` returns only global memories.
- `listMemories({ scope: 'project', projectPath })` returns only project memories
  matching that exact path.

Memories are always-on notes: they do not have folders, tags, enable/disable
state, per-session opt-ins, or per-session mutes. They are preserved and restored
during schema-version bumps through `preserveMemories()` and `restoreMemories()`.

Injection consumers:

- `desktop/src/main/utility/backend/tools/register-connection.ts` passes memories
  into `buildStartupContextMessage()` during explicit registration.
- `desktop/src/main/utility/backend/tools/db-context-injection.ts` lists memories
  for auto-registration/startup context injection.
- External clients manipulate this table through the `manage_memories` MCP tool.

---

## Public Types

### `SkillScope`

```ts
export type SkillScope = 'global' | 'session-scoped';
```

Controls skill/instruction injection eligibility.

### `InstructionDeliveryMode`

```ts
export type InstructionDeliveryMode = 'always' | 'catalog';
```

Controls how instruction content is delivered.

### `SkillOrInstruction`

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
  folderId: number | null;
  scope: SkillScope;
  deliveryMode?: InstructionDeliveryMode;
  alwaysModeWarning?: string | null;
}
```

### `Folder`

```ts
export interface Folder {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}
```

### `MemoryScope` and `Memory`

```ts
export type MemoryScope = 'global' | 'project';

export interface Memory {
  id: number;
  scope: MemoryScope;
  projectPath: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}
```

### `ConversationRecord`

```ts
export interface ConversationRecord {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  attachments: string | null;
  createdAt: string;
}
```

### `SessionChannelMessageRecord`

```ts
export interface SessionChannelMessageRecord {
  id: number;
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
}
```

### `RegisteredConnection`

```ts
export interface RegisteredConnection {
  providerSessionId: string;
  connectionId: string | null;
  channelName: string;
  projectName: string;
  baseDirectory: string | null;
  idFilePath: string;
  parentSessionId: string | null;
  providerType: 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone';
  createdAt: string;
  updatedAt: string;
}
```

### `ContextInjection`

```ts
export interface ContextInjection {
  id: number;
  source: string;
  payload: string;
  createdAt: string;
}
```

### `PinnedProject`

```ts
export interface PinnedProject {
  path: string;
  name: string;
  createdAt: string;
}
```

---

## Public API

All functions below are exported from `database.ts`. Unless otherwise noted,
functions return safe fallbacks when the module-level database instance is not
initialized: `null`, `[]`, `0`, `false`, or no-op `void` depending on the return
type.

### Core database helpers

```ts
export function getDbInstance(): BetterSqliteDatabase | null;
export function flushPersistNow(): void;
export function __cancelPendingPersistForTests(): void;
```

- `getDbInstance()` returns the internal `better-sqlite3` database object or
  `null` before initialization.
- `flushPersistNow()` is a compatibility no-op; writes are already handled by
  SQLite.
- `__cancelPendingPersistForTests()` is a test-compatibility no-op.

### Conversation history

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

export function getConversationHistory(limit?: number): ConversationRecord[];
export function clearHistory(): void;
```

- `saveConversation()` inserts one row. `predefinedOptions` and `attachments` are
  JSON-encoded when present.
- `getConversationHistory(limit = 100)` returns newest rows first by
  `created_at DESC`.
- `clearHistory()` deletes all rows from `conversations` only.

### Full database reset

```ts
export function resetDatabase(): {
  ok: boolean;
  clearedTables: string[];
  removedIdFiles: number;
};
```

`resetDatabase()` removes ID files for all registered connections, then deletes
rows from these tables:

```ts
[
  'session_scoped_entries',
  'session_muted_entries',
  'session_messages',
  'session_channel_history',
  'session_channels',
  'registered_connections',
  'conversations',
  'skills_and_instructions',
  'folders',
];
```

It currently does **not** clear `pending_context_injections`, `pinned_projects`,
or `memories`.

### Session channels and queued messages

```ts
export function createSessionChannel(sessionId: string, label?: string): void;

export function getUnsentMessages(
  sessionId: string,
): { id: number; message: string; createdAt: string }[];

export function getUnsentCount(sessionId: string): number;
export function markMessagesSent(ids: number[]): void;
export function queueSessionMessage(sessionId: string, message: string): void;

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

export function getSessionChannelHistory(
  sessionId: string,
  limit?: number,
): SessionChannelMessageRecord[];

export function clearSessionChannelMessages(sessionId: string): void;
export function deleteSessionChannel(sessionId: string): void;

export function getActiveSessionChannels(): {
  sessionId: string;
  label: string | null;
  createdAt: string;
  providerSessionId: string | null;
  parentSessionId: string | null;
}[];
```

Notes:

- `createSessionChannel()` uses `INSERT OR REPLACE`.
- `queueSessionMessage()` writes both `session_messages` and an `outbound`
  history row in a transaction.
- `getSessionChannelHistory(sessionId, limit = 500)` returns `id ASC` order.
- `clearSessionChannelMessages()` deletes queue and history rows for a session.
- `deleteSessionChannel()` deletes queue, history, and channel rows.
- `getActiveSessionChannels()` left-joins `registered_connections` on
  `provider_session_id = session_id` and returns channels by creation time.

### Registered connections

```ts
export function agentIdFilePath(
  channelName: string,
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): string;

export function upsertRegisteredConnection(data: {
  providerSessionId: string;
  channelName: string;
  projectName: string;
  connectionId?: string | null;
  baseDirectory?: string;
  parentSessionId?: string | null;
  providerType?: RegisteredConnection['providerType'];
}): string;

export function getAllRegisteredConnections(): RegisteredConnection[];

export function getRegisteredConnection(
  connectionId: string,
): RegisteredConnection | null;

export function getRegisteredConnectionsByConnectionId(
  connectionId: string,
): RegisteredConnection[];

export function getRegisteredConnectionBySessionId(
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): RegisteredConnection | null;

export function updateConnectionId(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
  connectionId: string | null,
): void;

export function getRegisteredConnectionByName(
  channelName: string,
): RegisteredConnection | null;

export function isProviderSessionClaimed(
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): boolean;

export function getRegisteredConnectionsByProvider(
  providerType: RegisteredConnection['providerType'],
): RegisteredConnection[];

export function updateConnectionProviderSession(
  connectionId: string,
  oldProviderType: RegisteredConnection['providerType'],
  oldProviderSessionId: string,
  newProviderType: RegisteredConnection['providerType'],
  newProviderSessionId: string,
): void;

export function updateConnectionBaseDirectory(
  providerSessionId: string,
  baseDirectory: string,
  providerType?: RegisteredConnection['providerType'],
): void;

export function deleteRegisteredConnection(
  providerSessionId: string,
  providerType?: RegisteredConnection['providerType'],
): void;
```

Important behavior:

- `agentIdFilePath()` sanitizes channel, provider session, and provider type into
  `/tmp/imcp-agent-<provider>-<channel>-<identity>.json`.
- `upsertRegisteredConnection()` writes that temp JSON file and upserts the DB
  row on `(provider_type, provider_session_id)`.
- If an existing row already matches the incoming values, the upsert short-circuits
  to avoid churn from polling paths.
- `getRegisteredConnection(connectionId)` is a secondary lookup. When multiple
  rows share a transport `connection_id`, it returns the oldest row by
  `created_at` as a fallback for callers that omitted the canonical session ID.
- `deleteRegisteredConnection()` removes the temp ID file and deletes the
  registered connection, session-scoped opt-ins, and session mutes for that
  provider session in a transaction.

### Skills and instructions

```ts
export function getAlwaysInstructionWarning(content: string): string | null;

export function upsertSkillOrInstruction(data: {
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category?: string | null;
  tags?: string[] | null;
  folderId?: number | null;
  scope?: SkillScope;
  deliveryMode?: InstructionDeliveryMode;
}): SkillOrInstruction | null;

export function listSkillsAndInstructions(
  type?: 'skill' | 'instruction',
): SkillOrInstruction[];

export function getSkillOrInstructionByName(
  name: string,
): SkillOrInstruction | null;

export function deleteSkillOrInstruction(name: string): boolean;

export function toggleSkillOrInstructionEnabled(
  name: string,
  enabled: boolean,
): SkillOrInstruction | null;

export function setEntryInjectionMode(
  entryName: string,
  deliveryMode: InstructionDeliveryMode,
): SkillOrInstruction | null;

export function duplicateSkillOrInstruction(
  name: string,
): SkillOrInstruction | null;

export function seedBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): number;

export function resetBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): number;

export function getMissingBuiltinCount(templateNames: string[]): number;
```

Notes:

- `upsertSkillOrInstruction()` inserts defaults of `folder_id=NULL`,
  `scope='global'`, and `delivery_mode='always'` when omitted. On name conflict,
  folder/scope/delivery mode are overwritten only when explicitly provided.
- `listSkillsAndInstructions()` sorts by `type ASC, category ASC, name ASC`.
- `setEntryInjectionMode()` only updates existing instructions.
- `duplicateSkillOrInstruction()` creates `<name>-copy`, `<name>-copy-2`, etc.
- Built-in template seeding inserts missing templates only; reset updates existing
  rows and inserts missing rows.

### Pending context injections

```ts
export function upsertContextInjection(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
  payload: string,
  source?: string,
  replaceKey?: string,
): void;

export function claimContextInjections(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
): ContextInjection[];

export function deleteContextInjectionsForSession(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
): void;
```

- `upsertContextInjection()` uses a transaction. When `replaceKey` is supplied,
  it removes undelivered rows for the same provider session and key before
  inserting the replacement payload.
- `claimContextInjections()` uses a transaction to select undelivered rows and
  set `delivered=1` before returning them.
- `deleteContextInjectionsForSession()` removes delivered and undelivered rows for
  the provider session.

### Pinned projects

```ts
export function getPinnedProjects(): PinnedProject[];
export function addPinnedProject(path: string, name: string): boolean;
export function removePinnedProject(path: string): boolean;
export function isPinnedProject(path: string): boolean;
```

- `getPinnedProjects()` returns rows by `created_at DESC`.
- `addPinnedProject()` trims both inputs, rejects empty values, and uses
  `INSERT OR IGNORE`; it returns `true` only when a row was inserted.
- `removePinnedProject()` deletes by `path` and returns `true` after attempting
  the delete.
- `isPinnedProject()` returns `true` when a row exists for the path.

### Folders

```ts
export function listFolders(): Folder[];
export function getFolderById(id: number): Folder | null;
export function getFolderByName(name: string): Folder | null;
export function createFolder(name: string): Folder | null;
export function renameFolder(id: number, newName: string): Folder | null;
export function deleteFolder(id: number): boolean;
```

- Folder names are trimmed and must be non-empty.
- `createFolder()` returns `null` on duplicate name.
- `renameFolder()` rejects missing folders, empty names, and name collisions.
- `deleteFolder()` transactionally sets matching entry `folder_id` values to
  `NULL` before deleting the folder row.

### Entry folder/scope setters

```ts
export function setEntryFolder(
  entryName: string,
  folderId: number | null,
): boolean;

export function setEntryScope(entryName: string, scope: SkillScope): boolean;
```

- `setEntryFolder()` validates that a non-null folder exists before updating.
- `setEntryScope()` updates `scope` and `updated_at` for an existing entry.

### Session-scoped entry opt-ins

```ts
export function listSessionScopedEntryNames(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): string[];

export function setSessionScopedEntries(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryNames: string[],
): void;

export function addSessionScopedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void;

export function removeSessionScopedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void;

export function deleteSessionScopedEntriesForSession(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): void;
```

`setSessionScopedEntries()` replaces the full opt-in set in a transaction.
Names are recorded even if the corresponding catalog entry does not currently
exist; callers validate upstream when needed.

### Session-muted global entries

```ts
export function listSessionMutedEntryNames(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): string[];

export function setSessionMutedEntries(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryNames: string[],
): void;

export function addSessionMutedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void;

export function removeSessionMutedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void;

export function deleteSessionMutedEntriesForSession(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): void;
```

`setSessionMutedEntries()` replaces the full mute set in a transaction.

### Memories

```ts
export function createMemory(data: {
  scope: MemoryScope;
  projectPath?: string | null;
  content: string;
}): Memory | null;

export function getMemoryById(id: number): Memory | null;

export function listMemories(filter?: {
  scope?: MemoryScope;
  projectPath?: string;
}): Memory[];

export function updateMemory(
  id: number,
  patch: { content?: string; scope?: MemoryScope; projectPath?: string | null },
): Memory | null;

export function deleteMemory(id: number): boolean;
```

Behavior:

- `createMemory()` inserts a row and returns it by `lastInsertRowid`.
- `createMemory({ scope: 'project', ... })` throws
  `Error('createMemory: project scope requires projectPath')` when no project
  path is supplied.
- Global creates ignore `projectPath` and store `project_path=NULL`.
- `getMemoryById()` returns `null` when missing.
- `listMemories()` orders by `scope ASC, created_at ASC`.
- `updateMemory()` reads the existing row first, merges the patch, validates
  project scope, updates `updated_at=CURRENT_TIMESTAMP`, and returns the updated
  row. It throws `Error('updateMemory: project scope requires projectPath')` when
  the resulting scope is project without a path.
- `deleteMemory()` returns `true` only when a row was deleted.

---

## Query and Transaction Patterns

### Insert/update/delete

```ts
db.prepare(
  `INSERT INTO memories (scope, project_path, content) VALUES (?, ?, ?)`,
).run(scope, projectPath, content);
```

`run()` returns statement metadata including `changes` and `lastInsertRowid`.

### Single-row read

```ts
const row = db
  .prepare(
    `SELECT id, scope, project_path, content, created_at, updated_at
     FROM memories WHERE id = ?`,
  )
  .get(id) as MemoryRow | undefined;
```

Use `get()` for lookups expected to return at most one row.

### Multi-row read

```ts
const rows = db
  .prepare(
    `SELECT id, scope, project_path, content, created_at, updated_at
     FROM memories WHERE scope = ? ORDER BY scope ASC, created_at ASC`,
  )
  .all('global') as MemoryRow[];
```

Use `all()` for list queries.

### Transactions

Use `db.transaction(fn)` when multiple statements must commit or roll back
together. The returned function executes synchronously.

```ts
const txn = db.transaction((folderId: number) => {
  db!
    .prepare(
      `UPDATE skills_and_instructions SET folder_id = NULL WHERE folder_id = ?`,
    )
    .run(folderId);
  db!.prepare(`DELETE FROM folders WHERE id = ?`).run(folderId);
});

txn(id);
```

Current transactional paths include queued session messages, clearing/deleting
session channel data, deleting registered connections with their opt-in/mute
rows, replacing session-scoped entries, replacing session mutes, deleting folders,
upserting context injections with replacement, and claiming context injections.

### Dynamic `IN` clauses

When a variable number of parameters is required, the code builds placeholders
from the input length and passes values separately:

```ts
const placeholders = ids.map(() => '?').join(',');
db.prepare(
  `UPDATE session_messages SET sent = 1 WHERE id IN (${placeholders})`,
).run(...ids);
```

Only generated `?` placeholders are interpolated; values remain bound
parameters.

---

## Operational Notes

### Single database instance

The module stores the open database in a module-level variable:

```ts
let db: BetterSqliteDatabase | null = null;
let dbPath = '';
```

Callers should use exported functions rather than constructing additional
database handles. `getDbInstance()` exists for modules that need direct SQL
access, but new code should prefer explicit helper functions when practical.

### Cleanup behavior

- `resetDatabase()` removes temp ID files for registered connections before
  clearing its configured table list.
- `deleteRegisteredConnection()` removes the temp ID file for that provider
  session and deletes related opt-in/mute rows.
- `deleteFolder()` keeps catalog entries and moves them to the unfiled state.
- Startup deletes invalid pinned-project rows with blank path/name.

### Cross-document references

- [ARCHITECTURE.md](./ARCHITECTURE.md) documents where the database runs in the
  utility-process architecture and records the native SQLite migration note.
- [MCP-SERVER.md](./MCP-SERVER.md) documents MCP session registration and context
  delivery paths that use `registered_connections`, `pending_context_injections`,
  skills/instructions, and memories.
- [IPC-API.md](./IPC-API.md) documents renderer-facing APIs backed by database
  state.
- [BUILD-PACKAGING.md](./BUILD-PACKAGING.md) documents rebuild and packaging
  requirements for the native database dependency.
