import Database, {
  type Database as BetterSqliteDatabase,
} from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

let db: BetterSqliteDatabase | null = null;
let dbPath = '';

/**
 * Schema version — bump this whenever the DDL changes.
 * On startup: if the stored user_version doesn't match, the database is
 * dropped and recreated from scratch. This eliminates all incremental
 * migration code.
 */
const SCHEMA_VERSION = 14;

// ─── Public interfaces ─────────────────────────────────────────────────────

/**
 * Scope controls how a skill or instruction is injected into an agent session.
 * - 'global': injected into every newly registered session (current default behavior).
 * - 'session-scoped': injected only into sessions that have explicitly opted in
 *   via the `session_scoped_entries` table (per-channel selection UI).
 */
export type SkillScope = 'global' | 'session-scoped';

export type InstructionDeliveryMode = 'always' | 'catalog';

export const ALWAYS_INSTRUCTION_SOFT_LIMIT = 8_000;

export function getAlwaysInstructionWarning(content: string): string | null {
  if (content.length <= ALWAYS_INSTRUCTION_SOFT_LIMIT) {
    return null;
  }

  return `This instruction is ${content.length.toLocaleString()} characters long. Consider catalog mode to avoid oversized bootstrap reminders.`;
}

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
  /**
   * Optional folder the entry is organised under. Purely organisational —
   * folders are flat (no nesting) and have no effect on injection behavior.
   */
  folderId: number | null;
  scope: SkillScope;
  deliveryMode?: InstructionDeliveryMode;
  alwaysModeWarning?: string | null;
}

/**
 * Flat organisational folder for skills and instructions. Folders are
 * purely for UI grouping — they do not affect injection logic.
 */
export interface Folder {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRecord {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  attachments: string | null;
  createdAt: string;
}

export interface SessionChannelMessageRecord {
  id: number;
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
}

export interface RegisteredConnection {
  /**
   * Provider-specific session ID. This is the primary identifier within a provider:
   * - For 'opencode': The OpenCode session ID (e.g., ses_xxx)
   * - For 'copilot-cli': The MCP connectionId (UUID)
   * - For 'claude-sdk': The MCP connectionId (UUID)
   * - For 'standalone': The MCP connectionId (UUID)
   *
   * Combined with `providerType`, this forms the composite primary key.
   */
  providerSessionId: string;
  connectionId: string | null;
  channelName: string;
  projectName: string;
  baseDirectory: string | null;
  idFilePath: string;
  parentSessionId: string | null;
  /**
   * Provider type for this connection. Used to isolate connections from
   * different AI providers (OpenCode, Copilot CLI, Claude SDK, etc.).
   * - 'opencode': OpenCode sessions with session hierarchy and injection support
   * - 'copilot-cli': GitHub Copilot CLI connections
   * - 'claude-sdk': Anthropic Claude SDK connections
   * - 'standalone': Direct MCP connections without provider-specific features
   *
   * Combined with `providerSessionId`, this forms the composite primary key.
   * This prevents cross-provider contamination where different providers
   * could overwrite each other's connections.
   */
  providerType: 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone';
  createdAt: string;
  updatedAt: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Raw DB row shape for `registered_connections`. Field names match the
 * snake_case column names returned by better-sqlite3.
 */
interface RegisteredConnectionRow {
  provider_type: RegisteredConnection['providerType'];
  provider_session_id: string;
  connection_id: string | null;
  agent_name: string;
  project_name: string;
  base_directory: string | null;
  id_file_path: string;
  parent_session_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToRegisteredConnection(
  row: RegisteredConnectionRow,
): RegisteredConnection {
  return {
    providerType: row.provider_type ?? 'standalone',
    providerSessionId: row.provider_session_id,
    connectionId: row.connection_id,
    channelName: row.agent_name,
    projectName: row.project_name,
    baseDirectory: row.base_directory,
    idFilePath: row.id_file_path,
    parentSessionId: row.parent_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create all tables with their final column set.
 * Called on fresh DBs and after a schema-version mismatch wipe.
 */
function createTables(): void {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_message     TEXT    NOT NULL,
      project_name       TEXT    NOT NULL,
      user_response      TEXT    NOT NULL,
      predefined_options TEXT,
      attachments        TEXT,
      created_at         TEXT    DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_channels (
      session_id TEXT     PRIMARY KEY,
      label      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id         INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      message    TEXT     NOT NULL,
      sent       INTEGER  DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_channel_history (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT     NOT NULL,
      message_type TEXT     NOT NULL,
      message_text TEXT     NOT NULL,
      attachments  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
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
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      folder_id   INTEGER,
      scope       TEXT    NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'session-scoped')),
      delivery_mode TEXT  NOT NULL DEFAULT 'always' CHECK(delivery_mode IN ('always', 'catalog'))
    )
  `);

  // Flat organisational folders for skills/instructions.
  // Purely for UI grouping — no effect on injection behavior.
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Per-session opt-in list for scope='session-scoped' entries.
  // A row here means "this channel has opted into this entry."
  // Keyed on (providerType, providerSessionId) to survive transport reconnects.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_scoped_entries (
      provider_type       TEXT     NOT NULL,
      provider_session_id TEXT     NOT NULL,
      entry_name          TEXT     NOT NULL,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_type, provider_session_id, entry_name)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sse_entry_name
      ON session_scoped_entries (entry_name)
  `);

  // Per-session mute list for scope='global' entries.
  // A row here means "this channel has muted this global entry" — i.e. do
  // NOT inject it for this specific session, even though it's global.
  // Keyed on (providerType, providerSessionId) to survive transport reconnects.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_muted_entries (
      provider_type       TEXT     NOT NULL,
      provider_session_id TEXT     NOT NULL,
      entry_name          TEXT     NOT NULL,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_type, provider_session_id, entry_name)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sme_entry_name
      ON session_muted_entries (entry_name)
  `);

  db.exec(`
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
  `);

  // noReply context injections — for Copilot CLI / standalone mode.
  // Injections are claimed atomically and delivered via the poll_context_injections
  // MCP tool or auto-prepended to request_user_input responses.
  // Keyed on (provider_type, provider_session_id) — the canonical session identity —
  // so injections survive transport reconnects (which mint a new connectionId).
  db.exec(`
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
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pci_session_delivered
      ON pending_context_injections (provider_type, provider_session_id, delivered)
  `);

  // Pinned projects — manually added project folders that appear in sidebar
  // even when no sessions exist for them
  db.exec(`
    CREATE TABLE IF NOT EXISTS pinned_projects (
      path        TEXT     PRIMARY KEY,
      name        TEXT     NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ─── Initialization ────────────────────────────────────────────────────────

/**
 * Initialize the SQLite database using better-sqlite3 (native bindings).
 *
 * Uses WAL journal mode + synchronous=NORMAL for durable, fast writes without
 * full-file exports. This replaces the previous sql.js (WASM) implementation
 * which exhibited "RuntimeError: memory access out of bounds" after prolonged
 * use due to WASM heap fragmentation.
 *
 * Caller supplies `userDataPath` (previously derived from
 * `app.getPath('userData')`). This module now runs in the utility process,
 * which has no direct access to Electron's `app` module. Main forwards the
 * path via the init envelope (`utility/supervisor.ts`).
 *
 * `overridePath` may be passed to point at a specific DB file (e.g. tests).
 *
 * Kept `async` for API compatibility with existing callers — no await is
 * actually needed.
 */
export async function initDatabase(
  userDataPath: string,
  overridePath?: string,
): Promise<void> {
  dbPath = overridePath ?? join(userDataPath, 'conversations.db');

  db = new Database(dbPath);

  // WAL: concurrent readers + single writer, fast commits, no full rewrites.
  db.pragma('journal_mode = WAL');
  // NORMAL: fsync on checkpoint only (safe under WAL); ~10x faster than FULL.
  db.pragma('synchronous = NORMAL');
  // Enforce foreign keys (defensive — we don't currently use FKs).
  db.pragma('foreign_keys = ON');

  // Check stored schema version against expected version.
  // If they differ (or the DB is brand new with version 0), wipe and recreate.
  // User-authored skills/instructions are preserved across the wipe and
  // restored with scope='global', folder_id=NULL.
  const storedVersion = getSchemaVersion();
  if (storedVersion !== SCHEMA_VERSION) {
    const preservedSkills = preserveSkillsAndInstructions();
    dropAllTables();
    createTables();
    restoreSkillsAndInstructions(preservedSkills);
    setSchemaVersion(SCHEMA_VERSION);
  } else {
    // Schema matches — just ensure tables exist (idempotent).
    createTables();
  }
}

/**
 * Get the internal database reference for modules that need direct SQL access.
 * Returns null if the database is not initialized.
 */
export function getDbInstance(): BetterSqliteDatabase | null {
  return db;
}

/**
 * No-op retained for API compatibility with the previous sql.js implementation.
 * better-sqlite3 writes synchronously to disk; there is nothing to flush.
 *
 * Callers (e.g. `before-quit`) may still invoke this safely.
 */
export function flushPersistNow(): void {
  // No-op under better-sqlite3 — writes are already durable.
}

/**
 * Test-only: retained for API compatibility. No-op under better-sqlite3.
 */
export function __cancelPendingPersistForTests(): void {
  // No-op under better-sqlite3.
}

function getSchemaVersion(): number {
  if (!db) return 0;
  const row = db.pragma('user_version', { simple: true }) as number | undefined;
  return row ?? 0;
}

function setSchemaVersion(version: number): void {
  if (!db) return;
  db.pragma(`user_version = ${version}`);
}

function dropAllTables(): void {
  if (!db) return;
  // Order matters: drop dependents first to avoid FK issues (though we don't
  // use FK constraints, this keeps the intent clear).
  const tables = [
    'session_scoped_entries',
    'session_muted_entries',
    'pending_context_injections',
    'session_messages',
    'session_channel_history',
    'session_channels',
    'registered_connections',
    'conversations',
    'skills_and_instructions',
    'pinned_projects',
    'folders',
  ];
  for (const table of tables) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

/**
 * Snapshot of skill/instruction rows that should survive a schema-version
 * bump. Captures the raw column values we want to re-insert verbatim
 * (minus folder/scope, which default to the safe "global, unfiled" state
 * on restore).
 */
interface PreservedSkillRow {
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category: string | null;
  tags: string | null;
  enabled: number;
  isBuiltin: number;
  createdAt: string;
  updatedAt: string;
  deliveryMode: InstructionDeliveryMode;
}

/**
 * Read all rows from `skills_and_instructions` before the schema wipe.
 * Returns an empty array if the table doesn't exist yet (fresh DB) or any
 * read error occurs — the wipe is still safe to proceed.
 */
function preserveSkillsAndInstructions(): PreservedSkillRow[] {
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, delivery_mode
         FROM skills_and_instructions`,
      )
      .all() as Array<{
      name: string;
      type: 'skill' | 'instruction';
      description: string;
      content: string;
      category: string | null;
      tags: string | null;
      enabled: number | null;
      is_builtin: number | null;
      created_at: string;
      updated_at: string;
      delivery_mode: string | null;
    }>;
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      description: row.description,
      content: row.content,
      category: row.category,
      tags: row.tags,
      enabled: row.enabled ?? 1,
      isBuiltin: row.is_builtin ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deliveryMode: row.delivery_mode === 'catalog' ? 'catalog' : 'always',
    }));
  } catch {
    // Table doesn't exist (fresh DB) — nothing to preserve.
    return [];
  }
}

/**
 * Re-insert preserved skill/instruction rows after `createTables()`. New
 * `folder_id` defaults to NULL and `scope` to 'global' so existing content
 * behaves exactly as before the migration.
 */
function restoreSkillsAndInstructions(rows: PreservedSkillRow[]): void {
  if (!db || rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO skills_and_instructions
       (name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, folder_id, scope, delivery_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'global', ?)`,
  );
  for (const r of rows) {
    stmt.run(
      r.name,
      r.type,
      r.description,
      r.content,
      r.category,
      r.tags,
      r.enabled,
      r.isBuiltin,
      r.createdAt,
      r.updatedAt,
      r.deliveryMode,
    );
  }
}

// ─── Conversations ─────────────────────────────────────────────────────────

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
}): void {
  if (!db) return;
  db.prepare(
    `INSERT INTO conversations (prompt_message, project_name, user_response, predefined_options, attachments)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    data.promptMessage,
    data.projectName,
    data.userResponse,
    data.predefinedOptions ? JSON.stringify(data.predefinedOptions) : null,
    data.attachments?.length ? JSON.stringify(data.attachments) : null,
  );
}

export function getConversationHistory(limit = 100): ConversationRecord[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id, prompt_message, project_name, user_response, predefined_options, attachments, created_at
       FROM conversations ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as {
    id: number;
    prompt_message: string;
    project_name: string;
    user_response: string;
    predefined_options: string | null;
    attachments: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    promptMessage: row.prompt_message,
    projectName: row.project_name,
    userResponse: row.user_response,
    predefinedOptions: row.predefined_options,
    attachments: row.attachments,
    createdAt: row.created_at,
  }));
}

export function clearHistory(): void {
  if (!db) return;
  db.exec('DELETE FROM conversations');
}

// ─── Database reset ────────────────────────────────────────────────────────

export function resetDatabase(): {
  ok: boolean;
  clearedTables: string[];
  removedIdFiles: number;
} {
  if (!db) {
    return { ok: false, clearedTables: [], removedIdFiles: 0 };
  }

  // Clean up ID files on disk before wiping the table data.
  let removedIdFiles = 0;
  const registered = getAllRegisteredConnections();
  for (const rec of registered) {
    try {
      unlinkSync(rec.idFilePath);
      removedIdFiles += 1;
    } catch {
      // file may be missing; ignore
    }
  }

  const clearedTables = [
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

  for (const table of clearedTables) {
    db.exec(`DELETE FROM ${table}`);
  }

  return { ok: true, clearedTables, removedIdFiles };
}

// ─── Session channel functions ─────────────────────────────────────────────

export function createSessionChannel(sessionId: string, label?: string): void {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO session_channels (session_id, label) VALUES (?, ?)`,
  ).run(sessionId, label ?? null);
}

export function getUnsentMessages(
  sessionId: string,
): { id: number; message: string; createdAt: string }[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id, message, created_at FROM session_messages
       WHERE session_id = ? AND sent = 0 ORDER BY id ASC`,
    )
    .all(sessionId) as {
    id: number;
    message: string;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
  }));
}

export function getUnsentCount(sessionId: string): number {
  if (!db) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM session_messages WHERE session_id = ? AND sent = 0`,
    )
    .get(sessionId) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function markMessagesSent(ids: number[]): void {
  if (!db || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE session_messages SET sent = 1 WHERE id IN (${placeholders})`,
  ).run(...ids);
}

export function queueSessionMessage(sessionId: string, message: string): void {
  if (!db) return;
  const tx = db.transaction((sid: string, msg: string) => {
    db!
      .prepare(
        `INSERT INTO session_messages (session_id, message) VALUES (?, ?)`,
      )
      .run(sid, msg);
    db!
      .prepare(
        `INSERT INTO session_channel_history (session_id, message_type, message_text)
         VALUES (?, 'outbound', ?)`,
      )
      .run(sid, msg);
  });
  tx(sessionId, message);
}

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
}): void {
  if (!db) return;
  db.prepare(
    `INSERT INTO session_channel_history (session_id, message_type, message_text, attachments)
     VALUES (?, ?, ?, ?)`,
  ).run(
    data.sessionId,
    data.messageType,
    data.messageText,
    data.attachments?.length ? JSON.stringify(data.attachments) : null,
  );
}

export function getSessionChannelHistory(
  sessionId: string,
  limit = 500,
): SessionChannelMessageRecord[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id, session_id, message_type, message_text, attachments, created_at
       FROM session_channel_history
       WHERE session_id = ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(sessionId, limit) as {
    id: number;
    session_id: string;
    message_type: 'question' | 'answer' | 'outbound' | 'agent_message';
    message_text: string;
    attachments: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    messageType: row.message_type,
    messageText: row.message_text,
    attachments: row.attachments,
    createdAt: row.created_at,
  }));
}

export function clearSessionChannelMessages(sessionId: string): void {
  if (!db) return;
  const tx = db.transaction((sid: string) => {
    db!.prepare(`DELETE FROM session_messages WHERE session_id = ?`).run(sid);
    db!
      .prepare(`DELETE FROM session_channel_history WHERE session_id = ?`)
      .run(sid);
  });
  tx(sessionId);
}

export function deleteSessionChannel(sessionId: string): void {
  if (!db) return;
  const tx = db.transaction((sid: string) => {
    db!.prepare(`DELETE FROM session_messages WHERE session_id = ?`).run(sid);
    db!
      .prepare(`DELETE FROM session_channel_history WHERE session_id = ?`)
      .run(sid);
    db!.prepare(`DELETE FROM session_channels WHERE session_id = ?`).run(sid);
  });
  tx(sessionId);
}

export function getActiveSessionChannels(): {
  sessionId: string;
  label: string | null;
  createdAt: string;
  providerSessionId: string | null;
  parentSessionId: string | null;
}[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT sc.session_id, sc.label, sc.created_at,
              rc.provider_session_id, rc.parent_session_id
       FROM session_channels sc
       LEFT JOIN registered_connections rc ON rc.provider_session_id = sc.session_id
       ORDER BY sc.created_at ASC`,
    )
    .all() as {
    session_id: string;
    label: string | null;
    created_at: string;
    provider_session_id: string | null;
    parent_session_id: string | null;
  }[];
  return rows.map((row) => ({
    sessionId: row.session_id,
    label: row.label,
    createdAt: row.created_at,
    providerSessionId: row.provider_session_id ?? null,
    parentSessionId: row.parent_session_id ?? null,
  }));
}

// ─── Registered connections ────────────────────────────────────────────────

/**
 * Path for a per-agent connection ID file in /tmp.
 * Includes provider type to prevent collisions between providers.
 */
export function agentIdFilePath(
  channelName: string,
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'standalone',
): string {
  const safe = channelName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const identity = providerSessionId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const provider = providerType.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return join(tmpdir(), `imcp-agent-${provider}-${safe}-${identity}.json`);
}

/**
 * Upsert a registered connection. Writes the ID file to /tmp and persists
 * the record to the database.
 *
 * Uses composite primary key (provider_type, provider_session_id).
 *
 * `providerSessionId` is the canonical session identity:
 * - For OpenCode: the OpenCode session ID (ses_xxx)
 * - For other providers: the MCP connectionId captured at registration
 *
 * `connectionId` is the MCP transport handle, bound at MCP initialize time.
 *
 * ON CONFLICT on `(provider_type, provider_session_id)`: updates channelName,
 * projectName, baseDirectory, connectionId, parentSessionId, and updated_at.
 */
export function upsertRegisteredConnection(data: {
  providerSessionId: string;
  channelName: string;
  projectName: string;
  connectionId?: string | null;
  baseDirectory?: string;
  parentSessionId?: string | null;
  providerType?: RegisteredConnection['providerType'];
}): string {
  const providerType = data.providerType ?? 'standalone';
  const providerSessionId = data.providerSessionId;

  const idFilePath = agentIdFilePath(
    data.channelName,
    providerSessionId,
    providerType,
  );

  // No-op short-circuit: if an identical row already exists, skip both the
  // SQL UPDATE and the ID-file rewrite. The 4s session-tree poller calls this
  // for every OpenCode session on every tick; without this guard it would
  // churn the DB and filesystem every 4 seconds per session for no reason.
  //
  // `baseDirectory === undefined` means "leave the stored value alone"
  // (mirrors the `COALESCE(excluded.base_directory, base_directory)` in the
  // UPSERT below), so it matches any existing value.
  if (db) {
    const existing = getRegisteredConnectionBySessionId(
      providerSessionId,
      providerType,
    );
    if (existing) {
      const incomingConnectionId = data.connectionId ?? null;
      const incomingParentSessionId = data.parentSessionId ?? null;
      const baseDirUnchanged =
        data.baseDirectory === undefined ||
        existing.baseDirectory === data.baseDirectory;
      const unchanged =
        existing.connectionId === incomingConnectionId &&
        existing.channelName === data.channelName &&
        existing.projectName === data.projectName &&
        existing.parentSessionId === incomingParentSessionId &&
        existing.idFilePath === idFilePath &&
        baseDirUnchanged;
      if (unchanged) {
        return idFilePath;
      }
    }
  }

  // Write ID file so agents can read their connectionId back on restart
  try {
    writeFileSync(
      idFilePath,
      JSON.stringify({
        connectionId: data.connectionId ?? null,
        channelName: data.channelName,
        projectName: data.projectName,
        baseDirectory: data.baseDirectory ?? null,
        providerSessionId,
        parentSessionId: data.parentSessionId ?? null,
        providerType,
      }),
      'utf-8',
    );
  } catch {
    // non-critical — DB is the source of truth
  }

  if (db) {
    db.prepare(
      `INSERT INTO registered_connections
         (provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(provider_type, provider_session_id) DO UPDATE SET
         connection_id = excluded.connection_id,
         agent_name = excluded.agent_name,
         project_name = excluded.project_name,
         base_directory = COALESCE(excluded.base_directory, base_directory),
         id_file_path = excluded.id_file_path,
         parent_session_id = excluded.parent_session_id,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(
      providerType,
      providerSessionId,
      data.connectionId ?? null,
      data.channelName,
      data.projectName,
      data.baseDirectory ?? null,
      idFilePath,
      data.parentSessionId ?? null,
    );
  }

  return idFilePath;
}

/** Return all registered connections (used by the session-tree poller). */
export function getAllRegisteredConnections(): RegisteredConnection[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections ORDER BY created_at ASC`,
    )
    .all() as RegisteredConnectionRow[];
  return rows.map(mapRowToRegisteredConnection);
}

/**
 * Look up a registered connection by transport connectionId (secondary lookup).
 * Searches the `connection_id` column, which is now a nullable non-PK column.
 *
 * IMPORTANT (Bug 2 fix): When multiple rows share the same connection_id (which
 * happens with OpenCode because subagents share their parent's MCP transport),
 * prefer the OLDEST row (by created_at). The oldest row is the parent/root
 * session for that connection — most agent prompts that omit `openCodeSessionId`
 * originate from the root, not from a freshly-spawned subagent. Returning the
 * newest row caused first-prompt misrouting (Bug 2).
 *
 * The proper fix is for callers to always pass `openCodeSessionId` — this
 * fallback is only a safety net.
 */
export function getRegisteredConnection(
  connectionId: string,
): RegisteredConnection | null {
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE connection_id = ?
       ORDER BY created_at ASC, rowid ASC LIMIT 1`,
    )
    .get(connectionId) as RegisteredConnectionRow | undefined;
  if (!row) return null;
  return mapRowToRegisteredConnection(row);
}

/**
 * Return ALL registered connections sharing a given transport connectionId,
 * ordered by created_at ascending (oldest = root parent first).
 *
 * Used by the resolver to detect ambiguous fallback cases (multiple OpenCode
 * sessions sharing the same MCP transport because of session-shared clients).
 */
export function getRegisteredConnectionsByConnectionId(
  connectionId: string,
): RegisteredConnection[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE connection_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(connectionId) as RegisteredConnectionRow[];
  return rows.map(mapRowToRegisteredConnection);
}

/**
 * Primary lookup: find a registered connection by its composite key
 * (providerType, providerSessionId).
 */
export function getRegisteredConnectionBySessionId(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): RegisteredConnection | null {
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`,
    )
    .get(providerType, providerSessionId) as
    | RegisteredConnectionRow
    | undefined;
  if (!row) return null;
  return mapRowToRegisteredConnection(row);
}

/**
 * Bind a transport connectionId to an existing registered connection row.
 * Called at MCP initialize time when the SSE row already exists.
 */
export function updateConnectionId(
  providerSessionId: string,
  connectionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): void {
  if (!db) return;
  db.prepare(
    `UPDATE registered_connections
     SET connection_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE provider_type = ? AND provider_session_id = ?`,
  ).run(connectionId, providerType, providerSessionId);
}

/** Look up a registered connection by channel name. */
export function getRegisteredConnectionByName(
  channelName: string,
): RegisteredConnection | null {
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE agent_name = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(channelName) as RegisteredConnectionRow | undefined;
  if (!row) return null;
  return mapRowToRegisteredConnection(row);
}

/**
 * Returns true if the given provider session already has a registered
 * connection row (i.e. the session is claimed/owned).
 */
export function isProviderSessionClaimed(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): boolean {
  if (!db) return false;
  const row = db
    .prepare(
      `SELECT 1 as present FROM registered_connections
       WHERE provider_type = ? AND provider_session_id = ?
       LIMIT 1`,
    )
    .get(providerType, providerSessionId) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * Return all registered connections filtered by provider type.
 * Used by the session-tree manager to only show OpenCode sessions in the hierarchy.
 */
export function getRegisteredConnectionsByProvider(
  providerType: RegisteredConnection['providerType'],
): RegisteredConnection[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
       FROM registered_connections WHERE provider_type = ? ORDER BY created_at ASC`,
    )
    .all(providerType) as RegisteredConnectionRow[];
  return rows.map(mapRowToRegisteredConnection);
}

/**
 * Update the provider session ID on an existing registered connection.
 * Used by the SSE auto-bind logic to attach a just-created OpenCode child
 * session to the MCP connection that was registered within the same time window.
 *
 * With the composite PK, this creates a new row with the OpenCode session ID
 * and deletes the old standalone row (if it was a temporary connectionId-based row).
 */
export function updateConnectionProviderSession(
  connectionId: string,
  newProviderSessionId: string,
  newProviderType: RegisteredConnection['providerType'] = 'opencode',
): void {
  if (!db) return;

  // Find the existing row by connectionId
  const existing = getRegisteredConnection(connectionId);
  if (!existing) return;

  // If the provider type is changing, we need to delete the old row and create a new one
  // because provider_type is part of the composite PK
  if (
    existing.providerType !== newProviderType ||
    existing.providerSessionId !== newProviderSessionId
  ) {
    // Delete old row
    db.prepare(
      `DELETE FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`,
    ).run(existing.providerType, existing.providerSessionId);

    // Insert new row with the correct composite key
    upsertRegisteredConnection({
      providerSessionId: newProviderSessionId,
      providerType: newProviderType,
      connectionId,
      channelName: existing.channelName,
      projectName: existing.projectName,
      baseDirectory: existing.baseDirectory ?? undefined,
      parentSessionId: existing.parentSessionId ?? undefined,
    });
  } else {
    // Same composite key, just update the row
    db.prepare(
      `UPDATE registered_connections
       SET updated_at = CURRENT_TIMESTAMP
       WHERE provider_type = ? AND provider_session_id = ?`,
    ).run(newProviderType, newProviderSessionId);
  }
}

/**
 * Update the baseDirectory for a registered connection.
 * Used when the user selects a project folder for an existing session.
 *
 * @param providerSessionId The provider-specific session ID (composite key part)
 * @param baseDirectory The new base directory path
 * @param providerType The provider type (composite key part), defaults to 'opencode'
 */
export function updateConnectionBaseDirectory(
  providerSessionId: string,
  baseDirectory: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): void {
  if (!db) return;
  db.prepare(
    `UPDATE registered_connections
     SET base_directory = ?, updated_at = CURRENT_TIMESTAMP
     WHERE provider_type = ? AND provider_session_id = ?`,
  ).run(baseDirectory, providerType, providerSessionId);
}

/**
 * Delete a registered connection from the DB and remove the ID file from disk.
 * Called when the user removes a session from the UI.
 *
 * @param providerSessionId The provider-specific session ID (composite key part)
 * @param providerType The provider type (composite key part), defaults to 'opencode'
 */
export function deleteRegisteredConnection(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): void {
  if (!db) return;
  const rec = getRegisteredConnectionBySessionId(
    providerSessionId,
    providerType,
  );
  if (rec) {
    try {
      unlinkSync(rec.idFilePath);
    } catch {
      // file may already be gone
    }
  }
  const txn = db.transaction((pt: string, psid: string) => {
    db!
      .prepare(
        `DELETE FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`,
      )
      .run(pt, psid);
    db!
      .prepare(
        `DELETE FROM session_scoped_entries WHERE provider_type = ? AND provider_session_id = ?`,
      )
      .run(pt, psid);
    db!
      .prepare(
        `DELETE FROM session_muted_entries WHERE provider_type = ? AND provider_session_id = ?`,
      )
      .run(pt, psid);
  });
  txn(providerType, providerSessionId);
}

// ─── Skills & Instructions ─────────────────────────────────────────────────

interface SkillOrInstructionRow {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category: string | null;
  tags: string | null;
  enabled: number;
  is_builtin: number;
  created_at: string;
  updated_at: string;
  folder_id: number | null;
  scope: string | null;
  delivery_mode: string | null;
}

function mapRowToSkillOrInstruction(
  row: SkillOrInstructionRow,
): SkillOrInstruction {
  let tags: string[] | null = null;
  if (row.tags) {
    try {
      tags = JSON.parse(row.tags) as string[];
    } catch {
      tags = null;
    }
  }
  const scopeRaw = row.scope ?? 'global';
  const scope: SkillScope =
    scopeRaw === 'session-scoped' ? 'session-scoped' : 'global';
  const deliveryModeRaw = row.delivery_mode ?? 'always';
  const deliveryMode: InstructionDeliveryMode =
    deliveryModeRaw === 'catalog' ? 'catalog' : 'always';
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    content: row.content,
    category: row.category,
    tags,
    enabled: row.enabled === 1,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    folderId: row.folder_id ?? null,
    scope,
    deliveryMode,
    alwaysModeWarning:
      row.type === 'instruction' && deliveryMode === 'always'
        ? getAlwaysInstructionWarning(row.content)
        : null,
  };
}

/**
 * Upsert a skill or instruction. If a record with the same name exists, it is updated.
 *
 * `folderId` and `scope` are optional:
 * - On INSERT, omitting them uses the column defaults (`folder_id=NULL`,
 *   `scope='global'`).
 * - On UPDATE (name conflict), they are only overwritten when explicitly
 *   provided — passing `undefined` keeps the existing folder/scope intact.
 */
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
}): SkillOrInstruction | null {
  if (!db) return null;
  const tagsJson = data.tags ? JSON.stringify(data.tags) : null;
  const folderIdValue = data.folderId === undefined ? null : data.folderId;
  const scopeValue: SkillScope = data.scope ?? 'global';
  const deliveryModeValue: InstructionDeliveryMode =
    data.deliveryMode ?? 'always';
  const hasExplicitFolder = data.folderId !== undefined;
  const hasExplicitScope = data.scope !== undefined;
  const hasExplicitDeliveryMode = data.deliveryMode !== undefined;
  const updateFolderClause = hasExplicitFolder
    ? 'folder_id = excluded.folder_id,'
    : '';
  const updateScopeClause = hasExplicitScope ? 'scope = excluded.scope,' : '';
  const updateDeliveryModeClause = hasExplicitDeliveryMode
    ? 'delivery_mode = excluded.delivery_mode,'
    : '';
  db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, tags, folder_id, scope, delivery_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
        type = excluded.type,
        description = excluded.description,
        content = excluded.content,
        category = excluded.category,
        tags = excluded.tags,
        ${updateFolderClause}
        ${updateScopeClause}
        ${updateDeliveryModeClause}
        updated_at = CURRENT_TIMESTAMP`,
  ).run(
    data.name,
    data.type,
    data.description,
    data.content,
    data.category ?? null,
    tagsJson,
    folderIdValue,
    scopeValue,
    deliveryModeValue,
  );
  return getSkillOrInstructionByName(data.name);
}

/** List all skills and instructions, optionally filtered by type and/or category. */
export function listSkillsAndInstructions(
  filterType?: 'skill' | 'instruction',
  filterCategory?: string,
): SkillOrInstruction[] {
  if (!db) return [];

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filterType) {
    conditions.push('type = ?');
    params.push(filterType);
  }
  if (filterCategory) {
    conditions.push('category = ?');
    params.push(filterCategory);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT id, name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, folder_id, scope, delivery_mode
     FROM skills_and_instructions ${whereClause} ORDER BY name ASC`;

  const rows = db.prepare(query).all(...params) as SkillOrInstructionRow[];
  return rows.map(mapRowToSkillOrInstruction);
}

/** Get a single skill or instruction by name. */
export function getSkillOrInstructionByName(
  name: string,
): SkillOrInstruction | null {
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT id, name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at, folder_id, scope, delivery_mode
       FROM skills_and_instructions WHERE name = ?`,
    )
    .get(name) as SkillOrInstructionRow | undefined;
  if (!row) return null;
  return mapRowToSkillOrInstruction(row);
}

/** Delete a skill or instruction by name. Returns true if a row was deleted. */
export function deleteSkillOrInstruction(name: string): boolean {
  if (!db) return false;
  const info = db
    .prepare(`DELETE FROM skills_and_instructions WHERE name = ?`)
    .run(name);
  return info.changes > 0;
}

/** Toggle the enabled status of a skill or instruction. Returns the updated record or null. */
export function toggleSkillOrInstructionEnabled(
  name: string,
  enabled: boolean,
): SkillOrInstruction | null {
  if (!db) return null;
  db.prepare(
    `UPDATE skills_and_instructions
     SET enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
  ).run(enabled ? 1 : 0, name);
  return getSkillOrInstructionByName(name);
}

export function setEntryInjectionMode(
  entryName: string,
  deliveryMode: InstructionDeliveryMode,
): SkillOrInstruction | null {
  if (!db) return null;
  const existing = getSkillOrInstructionByName(entryName);
  if (!existing || existing.type !== 'instruction') return null;
  db.prepare(
    `UPDATE skills_and_instructions
     SET delivery_mode = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
  ).run(deliveryMode, entryName);
  return getSkillOrInstructionByName(entryName);
}

/**
 * Duplicate a skill or instruction with a new name.
 * The new name will be "{original-name}-copy" or "{original-name}-copy-2", etc.
 * Returns the newly created record or null if the original doesn't exist.
 */
export function duplicateSkillOrInstruction(
  name: string,
): SkillOrInstruction | null {
  if (!db) return null;

  const original = getSkillOrInstructionByName(name);
  if (!original) return null;

  // Generate a unique copy name
  let copyName = `${name}-copy`;
  let suffix = 1;
  while (getSkillOrInstructionByName(copyName) !== null) {
    suffix += 1;
    copyName = `${name}-copy-${suffix}`;
  }

  db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, enabled, delivery_mode)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    copyName,
    original.type,
    original.description,
    original.content,
    original.enabled ? 1 : 0,
    original.deliveryMode ?? 'always',
  );
  return getSkillOrInstructionByName(copyName);
}

/**
 * Seed built-in templates into the database.
 * Only inserts templates that don't already exist (by name).
 * Returns the count of templates that were newly inserted.
 */
export function seedBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): number {
  if (!db) return 0;

  const existsStmt = db.prepare(
    `SELECT 1 as present FROM skills_and_instructions WHERE name = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, is_builtin, enabled)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
  );

  let insertedCount = 0;
  for (const template of templates) {
    const existing = existsStmt.get(template.name) as
      | { present: number }
      | undefined;
    if (existing) continue;

    insertStmt.run(
      template.name,
      template.type,
      template.description,
      template.content,
      template.category,
    );
    insertedCount++;
  }

  return insertedCount;
}

/**
 * Reset built-in templates to their default content.
 * Re-inserts any missing built-in templates and updates existing ones
 * to match the original content.
 * Returns the count of templates that were reset/inserted.
 */
export function resetBuiltinTemplates(
  templates: {
    name: string;
    type: 'skill' | 'instruction';
    category: string;
    description: string;
    content: string;
  }[],
): number {
  if (!db) return 0;

  const existsStmt = db.prepare(
    `SELECT 1 as present FROM skills_and_instructions WHERE name = ?`,
  );
  const updateStmt = db.prepare(
    `UPDATE skills_and_instructions
     SET type = ?, description = ?, content = ?, category = ?, is_builtin = 1, enabled = 1, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, is_builtin, enabled)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
  );

  let resetCount = 0;
  for (const template of templates) {
    const existing = existsStmt.get(template.name) as
      | { present: number }
      | undefined;
    if (existing) {
      updateStmt.run(
        template.type,
        template.description,
        template.content,
        template.category,
        template.name,
      );
    } else {
      insertStmt.run(
        template.name,
        template.type,
        template.description,
        template.content,
        template.category,
      );
    }
    resetCount++;
  }

  return resetCount;
}

/**
 * Get count of missing built-in templates.
 * Returns how many of the provided template names don't exist in the database.
 */
export function getMissingBuiltinCount(templateNames: string[]): number {
  if (!db || templateNames.length === 0) return 0;

  const placeholders = templateNames.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM skills_and_instructions WHERE name IN (${placeholders})`,
    )
    .get(...templateNames) as { c: number } | undefined;

  const existingCount = row?.c ?? 0;
  return templateNames.length - existingCount;
}

// ─── Pending Context Injections ────────────────────────────────────────────

export interface ContextInjection {
  id: number;
  source: string;
  payload: string;
  createdAt: string;
}

/**
 * Queue a noReply context injection for delivery to a provider session.
 * When `replaceKey` is provided, any existing undelivered injection with
 * the same (providerType, providerSessionId, replaceKey) is replaced —
 * useful for doc context (latest wins). Without `replaceKey`, a new row is
 * always appended.
 */
export function upsertContextInjection(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
  payload: string,
  source = 'manual',
  replaceKey?: string,
): void {
  if (!db) return;
  const tx = db.transaction(() => {
    if (replaceKey) {
      db!
        .prepare(
          `DELETE FROM pending_context_injections
           WHERE provider_type = ? AND provider_session_id = ? AND replace_key = ? AND delivered = 0`,
        )
        .run(providerType, providerSessionId, replaceKey);
    }
    db!
      .prepare(
        `INSERT INTO pending_context_injections (provider_type, provider_session_id, source, replace_key, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        providerType,
        providerSessionId,
        source,
        replaceKey ?? null,
        payload,
      );
  });
  tx();
}

/**
 * Atomically claim and return all undelivered injections for a provider session.
 * Marks them as delivered immediately. Safe in single-threaded Node.js.
 */
export function claimContextInjections(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
): ContextInjection[] {
  if (!db) return [];
  const selectStmt = db.prepare(
    `SELECT id, source, payload, created_at
     FROM pending_context_injections
     WHERE provider_type = ? AND provider_session_id = ? AND delivered = 0
     ORDER BY id ASC`,
  );

  const tx = db.transaction(
    (pType: RegisteredConnection['providerType'], pSid: string) => {
      const rows = selectStmt.all(pType, pSid) as {
        id: number;
        source: string;
        payload: string;
        created_at: string;
      }[];
      if (rows.length === 0) return [] as ContextInjection[];

      const items: ContextInjection[] = rows.map((row) => ({
        id: row.id,
        source: row.source,
        payload: row.payload,
        createdAt: row.created_at,
      }));

      const ids = items.map((item) => item.id);
      const placeholders = ids.map(() => '?').join(',');
      db!
        .prepare(
          `UPDATE pending_context_injections SET delivered = 1 WHERE id IN (${placeholders})`,
        )
        .run(...ids);
      return items;
    },
  );

  return tx(providerType, providerSessionId);
}

/** Remove all context injections (delivered or not) for a provider session. */
export function deleteContextInjectionsForSession(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'],
): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM pending_context_injections WHERE provider_type = ? AND provider_session_id = ?`,
  ).run(providerType, providerSessionId);
}

// ─── Pinned Projects ───────────────────────────────────────────────────────

export interface PinnedProject {
  path: string;
  name: string;
  createdAt: string;
}

/** Get all pinned projects. */
export function getPinnedProjects(): PinnedProject[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT path, name, created_at FROM pinned_projects ORDER BY created_at DESC`,
    )
    .all() as { path: string; name: string; created_at: string }[];
  return rows.map((row) => ({
    path: row.path,
    name: row.name,
    createdAt: row.created_at,
  }));
}

/** Add a pinned project. Returns true if added, false if already exists. */
export function addPinnedProject(path: string, name: string): boolean {
  if (!db) return false;
  try {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO pinned_projects (path, name) VALUES (?, ?)`,
      )
      .run(path, name);
    return info.changes > 0;
  } catch {
    return false;
  }
}

/** Remove a pinned project by path. */
export function removePinnedProject(path: string): boolean {
  if (!db) return false;
  db.prepare(`DELETE FROM pinned_projects WHERE path = ?`).run(path);
  return true;
}

/** Check if a project path is pinned. */
export function isPinnedProject(path: string): boolean {
  if (!db) return false;
  const row = db
    .prepare(`SELECT 1 as present FROM pinned_projects WHERE path = ? LIMIT 1`)
    .get(path) as { present: number } | undefined;
  return row !== undefined;
}

// ─── Folders ───────────────────────────────────────────────────────────────

interface FolderRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

function mapRowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List all folders, ordered by name ascending. */
export function listFolders(): Folder[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id, name, created_at, updated_at FROM folders ORDER BY name ASC`,
    )
    .all() as FolderRow[];
  return rows.map(mapRowToFolder);
}

/** Get a single folder by id. Returns null if not found. */
export function getFolderById(id: number): Folder | null {
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT id, name, created_at, updated_at FROM folders WHERE id = ?`,
    )
    .get(id) as FolderRow | undefined;
  if (!row) return null;
  return mapRowToFolder(row);
}

/** Get a single folder by name. Returns null if not found. */
export function getFolderByName(name: string): Folder | null {
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT id, name, created_at, updated_at FROM folders WHERE name = ?`,
    )
    .get(name) as FolderRow | undefined;
  if (!row) return null;
  return mapRowToFolder(row);
}

/**
 * Create a folder. Returns the new folder, or null if a folder with the
 * same name already exists (UNIQUE constraint).
 */
export function createFolder(name: string): Folder | null {
  if (!db) return null;
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (getFolderByName(trimmed) !== null) return null;
  db.prepare(`INSERT INTO folders (name) VALUES (?)`).run(trimmed);
  return getFolderByName(trimmed);
}

/**
 * Rename a folder. Returns the updated folder, or null if the folder
 * doesn't exist or the new name collides with another folder.
 */
export function renameFolder(id: number, newName: string): Folder | null {
  if (!db) return null;
  const trimmed = newName.trim();
  if (trimmed === '') return null;
  const existing = getFolderById(id);
  if (!existing) return null;
  const collision = getFolderByName(trimmed);
  if (collision && collision.id !== id) return null;
  db.prepare(
    `UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(trimmed, id);
  return getFolderById(id);
}

/**
 * Delete a folder. Any skills/instructions referencing this folder have
 * their `folder_id` nullified (moved to the "Unfiled" root). Entries
 * themselves are NOT deleted. Returns true when a folder row was deleted.
 */
export function deleteFolder(id: number): boolean {
  if (!db) return false;
  const existing = getFolderById(id);
  if (!existing) return false;
  const txn = db.transaction((folderId: number) => {
    db!
      .prepare(
        `UPDATE skills_and_instructions SET folder_id = NULL WHERE folder_id = ?`,
      )
      .run(folderId);
    db!.prepare(`DELETE FROM folders WHERE id = ?`).run(folderId);
  });
  txn(id);
  return true;
}

// ─── Skill/Instruction folder + scope setters ──────────────────────────────

/**
 * Assign an entry to a folder (or move to "Unfiled" with folderId=null).
 * Returns true when the entry exists and was updated. If `folderId` is
 * non-null and the folder does not exist, returns false (no change).
 */
export function setEntryFolder(
  entryName: string,
  folderId: number | null,
): boolean {
  if (!db) return false;
  if (folderId !== null && getFolderById(folderId) === null) return false;
  const existing = getSkillOrInstructionByName(entryName);
  if (!existing) return false;
  db.prepare(
    `UPDATE skills_and_instructions
     SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
  ).run(folderId, entryName);
  return true;
}

/**
 * Set the injection scope for an entry. 'global' means the entry is
 * injected into every newly registered session. 'session-scoped' means
 * it is injected only into sessions that have opted in via
 * `addSessionScopedEntry` / `setSessionScopedEntries`.
 */
export function setEntryScope(entryName: string, scope: SkillScope): boolean {
  if (!db) return false;
  const existing = getSkillOrInstructionByName(entryName);
  if (!existing) return false;
  db.prepare(
    `UPDATE skills_and_instructions
     SET scope = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
  ).run(scope, entryName);
  return true;
}

// ─── Session-scoped entry opt-in ───────────────────────────────────────────

/**
 * Return the entry names that a given session has opted into for
 * session-scoped injection. Does NOT filter by the entry's current scope
 * — callers should cross-reference `listSkillsAndInstructions()` if they
 * need only entries that are still marked 'session-scoped'.
 */
export function listSessionScopedEntryNames(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): string[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT entry_name FROM session_scoped_entries
       WHERE provider_type = ? AND provider_session_id = ?
       ORDER BY entry_name ASC`,
    )
    .all(providerType, providerSessionId) as Array<{ entry_name: string }>;
  return rows.map((row) => row.entry_name);
}

/**
 * Replace the full opt-in set for a session. Any prior opt-ins not in
 * `entryNames` are removed; new names are inserted. Names that don't
 * correspond to any existing entry are still recorded (useful when the
 * entry is created later) — callers may validate upstream if desired.
 */
export function setSessionScopedEntries(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryNames: string[],
): void {
  if (!db) return;
  const txn = db.transaction((pt: string, psid: string, names: string[]) => {
    db!
      .prepare(
        `DELETE FROM session_scoped_entries
         WHERE provider_type = ? AND provider_session_id = ?`,
      )
      .run(pt, psid);
    const insert = db!.prepare(
      `INSERT OR IGNORE INTO session_scoped_entries (provider_type, provider_session_id, entry_name)
       VALUES (?, ?, ?)`,
    );
    for (const name of names) {
      insert.run(pt, psid, name);
    }
  });
  txn(providerType, providerSessionId, entryNames);
}

/** Add a single opt-in. Idempotent. */
export function addSessionScopedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO session_scoped_entries (provider_type, provider_session_id, entry_name)
     VALUES (?, ?, ?)`,
  ).run(providerType, providerSessionId, entryName);
}

/** Remove a single opt-in. No-op if not present. */
export function removeSessionScopedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM session_scoped_entries
     WHERE provider_type = ? AND provider_session_id = ? AND entry_name = ?`,
  ).run(providerType, providerSessionId, entryName);
}

/**
 * Remove all session-scoped opt-ins for a provider session. Call this
 * from any path that deletes the session/channel to avoid orphan rows.
 */
export function deleteSessionScopedEntriesForSession(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM session_scoped_entries
     WHERE provider_type = ? AND provider_session_id = ?`,
  ).run(providerType, providerSessionId);
}

// ─── Session-muted entry list (per-session mute for global entries) ────────

/**
 * Return the entry names that a given session has muted — i.e. global
 * entries the user does NOT want injected into this specific session.
 * Does NOT filter by the entry's current scope; callers should cross-
 * reference `listSkillsAndInstructions()` when relevant.
 */
export function listSessionMutedEntryNames(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): string[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT entry_name FROM session_muted_entries
       WHERE provider_type = ? AND provider_session_id = ?
       ORDER BY entry_name ASC`,
    )
    .all(providerType, providerSessionId) as Array<{ entry_name: string }>;
  return rows.map((row) => row.entry_name);
}

/**
 * Replace the full mute set for a session. Any prior mutes not in
 * `entryNames` are removed; new names are inserted.
 */
export function setSessionMutedEntries(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryNames: string[],
): void {
  if (!db) return;
  const txn = db.transaction((pt: string, psid: string, names: string[]) => {
    db!
      .prepare(
        `DELETE FROM session_muted_entries
         WHERE provider_type = ? AND provider_session_id = ?`,
      )
      .run(pt, psid);
    const insert = db!.prepare(
      `INSERT OR IGNORE INTO session_muted_entries (provider_type, provider_session_id, entry_name)
       VALUES (?, ?, ?)`,
    );
    for (const name of names) {
      insert.run(pt, psid, name);
    }
  });
  txn(providerType, providerSessionId, entryNames);
}

/** Add a single mute. Idempotent. */
export function addSessionMutedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void {
  if (!db) return;
  db.prepare(
    `INSERT OR IGNORE INTO session_muted_entries (provider_type, provider_session_id, entry_name)
     VALUES (?, ?, ?)`,
  ).run(providerType, providerSessionId, entryName);
}

/** Remove a single mute. No-op if not present. */
export function removeSessionMutedEntry(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  entryName: string,
): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM session_muted_entries
     WHERE provider_type = ? AND provider_session_id = ? AND entry_name = ?`,
  ).run(providerType, providerSessionId, entryName);
}

/**
 * Remove all session mutes for a provider session. Call from any path
 * that deletes the session/channel to avoid orphan rows.
 */
export function deleteSessionMutedEntriesForSession(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
): void {
  if (!db) return;
  db.prepare(
    `DELETE FROM session_muted_entries
     WHERE provider_type = ? AND provider_session_id = ?`,
  ).run(providerType, providerSessionId);
}
