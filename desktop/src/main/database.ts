import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

/** A single SQL column value as returned by sql.js query results. */
type SqlValue = string | number | Uint8Array | null;

let db: SqlJsDatabase | null = null;
let dbPath = '';

/**
 * Schema version — bump this whenever the DDL changes.
 * On startup: if the stored user_version doesn't match, the database is
 * dropped and recreated from scratch. This eliminates all incremental
 * migration code.
 */
const SCHEMA_VERSION = 10;

// ─── Public interfaces ─────────────────────────────────────────────────────

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
  /**
   * @deprecated Use `providerSessionId` instead. Kept for backwards compatibility
   * during migration. For OpenCode connections, this equals `providerSessionId`.
   * For other providers, this is also set to `providerSessionId` for compatibility.
   */
  openCodeSessionId: string;
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

function persist(): void {
  if (!db) return;
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

/**
 * Create all tables with their final column set.
 * Called on fresh DBs and after a schema-version mismatch wipe.
 */
function createTables(): void {
  if (!db) return;

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS session_channels (
      session_id TEXT     PRIMARY KEY,
      label      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id         INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      message    TEXT     NOT NULL,
      sent       INTEGER  DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_channel_history (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT     NOT NULL,
      message_type TEXT     NOT NULL,
      message_text TEXT     NOT NULL,
      attachments  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
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
    )
  `);

  db.run(`
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
  db.run(`
    CREATE TABLE IF NOT EXISTS pending_context_injections (
      id            INTEGER  PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT     NOT NULL,
      source        TEXT     NOT NULL DEFAULT 'manual',
      replace_key   TEXT,
      payload       TEXT     NOT NULL,
      claimed       INTEGER  DEFAULT 0,
      delivered     INTEGER  DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_pci_connection_delivered
      ON pending_context_injections (connection_id, delivered)
  `);

  // Pinned projects — manually added project folders that appear in sidebar
  // even when no sessions exist for them
  db.run(`
    CREATE TABLE IF NOT EXISTS pinned_projects (
      path        TEXT     PRIMARY KEY,
      name        TEXT     NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Map a raw SQL row (10 columns) from `registered_connections` to a
 * `RegisteredConnection` object. Column order must match every SELECT that
 * queries this table:
 *   0 provider_type, 1 provider_session_id, 2 connection_id, 3 agent_name,
 *   4 project_name, 5 base_directory, 6 id_file_path, 7 parent_session_id,
 *   8 created_at, 9 updated_at
 */
function mapRowToRegisteredConnection(row: SqlValue[]): RegisteredConnection {
  const providerType =
    (row[0] as RegisteredConnection['providerType']) ?? 'standalone';
  const providerSessionId = row[1] as string;
  return {
    providerType,
    providerSessionId,
    // For backwards compatibility, openCodeSessionId mirrors providerSessionId
    openCodeSessionId: providerSessionId,
    connectionId: row[2] as string | null,
    channelName: row[3] as string,
    projectName: row[4] as string,
    baseDirectory: row[5] as string | null,
    idFilePath: row[6] as string,
    parentSessionId: row[7] as string | null,
    createdAt: row[8] as string,
    updatedAt: row[9] as string,
  };
}

// ─── Initialization ────────────────────────────────────────────────────────

export async function initDatabase(): Promise<void> {
  dbPath = join(app.getPath('userData'), 'conversations.db');

  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Check stored schema version against expected version.
  // If they differ (or the DB is brand new with version 0), wipe and recreate.
  const storedVersion = getSchemaVersion();
  if (storedVersion !== SCHEMA_VERSION) {
    dropAllTables();
    createTables();
    setSchemaVersion(SCHEMA_VERSION);
  } else {
    // Schema matches — just ensure tables exist (idempotent).
    createTables();
  }

  persist();
}

/**
 * Get the internal database reference for modules that need direct SQL access.
 * Returns null if the database is not initialized.
 */
export function getDbInstance(): SqlJsDatabase | null {
  return db;
}

function getSchemaVersion(): number {
  if (!db) return 0;
  const results = db.exec('PRAGMA user_version');
  if (results.length === 0 || results[0].values.length === 0) return 0;
  return (results[0].values[0][0] as number) ?? 0;
}

function setSchemaVersion(version: number): void {
  if (!db) return;
  db.run(`PRAGMA user_version = ${version}`);
}

function dropAllTables(): void {
  if (!db) return;
  // Order matters: drop dependents first to avoid FK issues (though we don't
  // use FK constraints, this keeps the intent clear).
  const tables = [
    'pending_context_injections',
    'session_messages',
    'session_channel_history',
    'session_channels',
    'registered_connections',
    'conversations',
    'skills_and_instructions',
  ];
  for (const table of tables) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
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

  db.run(
    `INSERT INTO conversations (prompt_message, project_name, user_response, predefined_options, attachments)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.promptMessage,
      data.projectName,
      data.userResponse,
      data.predefinedOptions ? JSON.stringify(data.predefinedOptions) : null,
      data.attachments?.length ? JSON.stringify(data.attachments) : null,
    ],
  );
  persist();
}

export function getConversationHistory(limit = 100): ConversationRecord[] {
  if (!db) return [];

  const results = db.exec(
    `SELECT id, prompt_message, project_name, user_response, predefined_options, attachments, created_at
     FROM conversations ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );

  if (results.length === 0) return [];

  return results[0].values.map((row) => ({
    id: row[0] as number,
    promptMessage: row[1] as string,
    projectName: row[2] as string,
    userResponse: row[3] as string,
    predefinedOptions: row[4] as string | null,
    attachments: row[5] as string | null,
    createdAt: row[6] as string,
  }));
}

export function clearHistory(): void {
  if (!db) return;
  db.run('DELETE FROM conversations');
  persist();
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
    'session_messages',
    'session_channel_history',
    'session_channels',
    'registered_connections',
    'conversations',
    'skills_and_instructions',
  ];

  for (const table of clearedTables) {
    db.run(`DELETE FROM ${table}`);
  }

  persist();

  return { ok: true, clearedTables, removedIdFiles };
}

// ─── Session channel functions ─────────────────────────────────────────────

export function createSessionChannel(sessionId: string, label?: string): void {
  if (!db) return;
  db.run(
    `INSERT OR REPLACE INTO session_channels (session_id, label) VALUES (?, ?)`,
    [sessionId, label ?? null],
  );
  persist();
}

export function getUnsentMessages(
  sessionId: string,
): { id: number; message: string; createdAt: string }[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT id, message, created_at FROM session_messages
     WHERE session_id = ? AND sent = 0 ORDER BY id ASC`,
    [sessionId],
  );
  if (results.length === 0) return [];
  return results[0].values.map((row) => ({
    id: row[0] as number,
    message: row[1] as string,
    createdAt: row[2] as string,
  }));
}

export function getUnsentCount(sessionId: string): number {
  if (!db) return 0;
  const results = db.exec(
    `SELECT COUNT(*) FROM session_messages WHERE session_id = ? AND sent = 0`,
    [sessionId],
  );
  if (results.length === 0) return 0;
  return (results[0].values[0][0] as number) ?? 0;
}

export function markMessagesSent(ids: number[]): void {
  if (!db || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.run(
    `UPDATE session_messages SET sent = 1 WHERE id IN (${placeholders})`,
    ids,
  );
  persist();
}

export function queueSessionMessage(sessionId: string, message: string): void {
  if (!db) return;
  db.run(`INSERT INTO session_messages (session_id, message) VALUES (?, ?)`, [
    sessionId,
    message,
  ]);
  db.run(
    `INSERT INTO session_channel_history (session_id, message_type, message_text)
     VALUES (?, 'outbound', ?)`,
    [sessionId, message],
  );
  persist();
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
  db.run(
    `INSERT INTO session_channel_history (session_id, message_type, message_text, attachments)
     VALUES (?, ?, ?, ?)`,
    [
      data.sessionId,
      data.messageType,
      data.messageText,
      data.attachments?.length ? JSON.stringify(data.attachments) : null,
    ],
  );
  persist();
}

export function getSessionChannelHistory(
  sessionId: string,
  limit = 500,
): SessionChannelMessageRecord[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT id, session_id, message_type, message_text, attachments, created_at
     FROM session_channel_history
     WHERE session_id = ?
     ORDER BY id ASC
     LIMIT ?`,
    [sessionId, limit],
  );
  if (results.length === 0) return [];
  return results[0].values.map((row) => ({
    id: row[0] as number,
    sessionId: row[1] as string,
    messageType: row[2] as 'question' | 'answer' | 'outbound' | 'agent_message',
    messageText: row[3] as string,
    attachments: row[4] as string | null,
    createdAt: row[5] as string,
  }));
}

export function clearSessionChannelMessages(sessionId: string): void {
  if (!db) return;
  db.run(`DELETE FROM session_messages WHERE session_id = ?`, [sessionId]);
  db.run(`DELETE FROM session_channel_history WHERE session_id = ?`, [
    sessionId,
  ]);
  persist();
}

export function deleteSessionChannel(sessionId: string): void {
  if (!db) return;
  db.run(`DELETE FROM session_messages WHERE session_id = ?`, [sessionId]);
  db.run(`DELETE FROM session_channel_history WHERE session_id = ?`, [
    sessionId,
  ]);
  db.run(`DELETE FROM session_channels WHERE session_id = ?`, [sessionId]);
  persist();
}

export function getActiveSessionChannels(): {
  sessionId: string;
  label: string | null;
  createdAt: string;
  openCodeSessionId: string | null;
  parentSessionId: string | null;
}[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT sc.session_id, sc.label, sc.created_at,
            rc.provider_session_id, rc.parent_session_id
     FROM session_channels sc
     LEFT JOIN registered_connections rc ON rc.provider_session_id = sc.session_id
     ORDER BY sc.created_at ASC`,
  );
  if (results.length === 0) return [];
  return results[0].values.map((row) => ({
    sessionId: row[0] as string,
    label: row[1] as string | null,
    createdAt: row[2] as string,
    openCodeSessionId: (row[3] as string | null) ?? null,
    parentSessionId: (row[4] as string | null) ?? null,
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
 * This ensures connections from different providers cannot overwrite each other.
 *
 * `providerSessionId` is the provider-specific session ID:
 * - For OpenCode: the OpenCode session ID (ses_xxx)
 * - For other providers: the MCP connectionId (UUID)
 *
 * `connectionId` is the MCP transport handle, bound at MCP initialize time.
 *
 * ON CONFLICT on `(provider_type, provider_session_id)`: updates channelName,
 * projectName, baseDirectory, connectionId, parentSessionId, and updated_at.
 *
 * For backwards compatibility, if `providerSessionId` is not provided but
 * `openCodeSessionId` is, the latter will be used.
 */
export function upsertRegisteredConnection(data: {
  /**
   * Provider-specific session ID. For OpenCode, this is the session ID.
   * For other providers, use the connectionId.
   */
  providerSessionId?: string;
  /**
   * @deprecated Use `providerSessionId` instead. If provided and providerSessionId
   * is not provided, this will be used as providerSessionId for backwards compatibility.
   */
  openCodeSessionId?: string;
  channelName: string;
  projectName: string;
  connectionId?: string | null;
  baseDirectory?: string;
  parentSessionId?: string | null;
  providerType?: RegisteredConnection['providerType'];
}): string {
  const providerType = data.providerType ?? 'standalone';
  // Use providerSessionId if provided, fall back to openCodeSessionId for backwards compat
  const providerSessionId = data.providerSessionId ?? data.openCodeSessionId;
  if (!providerSessionId) {
    throw new Error(
      'Either providerSessionId or openCodeSessionId must be provided',
    );
  }

  const idFilePath = agentIdFilePath(
    data.channelName,
    providerSessionId,
    providerType,
  );

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
        // Keep openCodeSessionId for backwards compatibility
        openCodeSessionId: providerSessionId,
        parentSessionId: data.parentSessionId ?? null,
        providerType,
      }),
      'utf-8',
    );
  } catch {
    // non-critical — DB is the source of truth
  }

  if (db) {
    db.run(
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
      [
        providerType,
        providerSessionId,
        data.connectionId ?? null,
        data.channelName,
        data.projectName,
        data.baseDirectory ?? null,
        idFilePath,
        data.parentSessionId ?? null,
      ],
    );
    persist();
  }

  return idFilePath;
}

/** Return all registered connections (used by the session-tree poller). */
export function getAllRegisteredConnections(): RegisteredConnection[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
     FROM registered_connections ORDER BY created_at ASC`,
  );
  if (results.length === 0) return [];
  return results[0].values.map(mapRowToRegisteredConnection);
}

/**
 * Look up a registered connection by transport connectionId (secondary lookup).
 * Searches the `connection_id` column, which is now a nullable non-PK column.
 */
export function getRegisteredConnection(
  connectionId: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE connection_id = ?
     ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
    [connectionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToRegisteredConnection(results[0].values[0]);
}

/**
 * Primary lookup: find a registered connection by its composite key
 * (providerType, providerSessionId).
 *
 * For backwards compatibility with code that only passes openCodeSessionId,
 * if providerType is omitted it defaults to 'opencode'.
 */
export function getRegisteredConnectionBySessionId(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`,
    [providerType, providerSessionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToRegisteredConnection(results[0].values[0]);
}

/**
 * Legacy lookup: find a registered connection by openCodeSessionId only.
 * This searches across all provider types but only returns the first match.
 * Prefer `getRegisteredConnectionBySessionId` with explicit providerType.
 *
 * @deprecated Use getRegisteredConnectionBySessionId with providerType instead.
 */
export function getRegisteredConnectionByOpenCodeSessionId(
  openCodeSessionId: string,
): RegisteredConnection | null {
  // For backwards compatibility, try 'opencode' provider first
  const result = getRegisteredConnectionBySessionId(
    openCodeSessionId,
    'opencode',
  );
  if (result) return result;

  // Fall back to searching any provider with this session ID
  if (!db) return null;
  const results = db.exec(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE provider_session_id = ? LIMIT 1`,
    [openCodeSessionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToRegisteredConnection(results[0].values[0]);
}

/**
 * Bind a transport connectionId to an existing registered connection row.
 * Called at MCP initialize time when the SSE row already exists.
 *
 * @param providerSessionId The provider-specific session ID (composite key part)
 * @param connectionId The MCP transport connectionId to bind
 * @param providerType The provider type (composite key part), defaults to 'opencode'
 */
export function updateConnectionId(
  providerSessionId: string,
  connectionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): void {
  if (!db) return;
  db.run(
    `UPDATE registered_connections
     SET connection_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE provider_type = ? AND provider_session_id = ?`,
    [connectionId, providerType, providerSessionId],
  );
  persist();
}

/** Look up a registered connection by channel name. */
export function getRegisteredConnectionByName(
  channelName: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE agent_name = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [channelName],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToRegisteredConnection(results[0].values[0]);
}

/**
 * Returns true if the given provider session already has a registered
 * connection row (i.e. the session is claimed/owned).
 *
 * @param providerSessionId The provider-specific session ID
 * @param providerType The provider type, defaults to 'opencode' for backwards compat
 */
export function isProviderSessionClaimed(
  providerSessionId: string,
  providerType: RegisteredConnection['providerType'] = 'opencode',
): boolean {
  if (!db) return false;
  const results = db.exec(
    `SELECT 1 FROM registered_connections
     WHERE provider_type = ? AND provider_session_id = ?
     LIMIT 1`,
    [providerType, providerSessionId],
  );
  return results.length > 0 && results[0].values.length > 0;
}

/**
 * @deprecated Use isProviderSessionClaimed with providerType instead.
 * Kept for backwards compatibility.
 */
export function isOpenCodeSessionClaimed(openCodeSessionId: string): boolean {
  return isProviderSessionClaimed(openCodeSessionId, 'opencode');
}

/**
 * Return all registered connections filtered by provider type.
 * Used by the session-tree manager to only show OpenCode sessions in the hierarchy.
 */
export function getRegisteredConnectionsByProvider(
  providerType: RegisteredConnection['providerType'],
): RegisteredConnection[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT provider_type, provider_session_id, connection_id, agent_name, project_name, base_directory, id_file_path, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE provider_type = ? ORDER BY created_at ASC`,
    [providerType],
  );
  if (results.length === 0) return [];
  return results[0].values.map(mapRowToRegisteredConnection);
}

/**
 * Update the provider session ID on an existing registered connection.
 * Used by the SSE auto-bind logic to attach a just-created OpenCode child
 * session to the MCP connection that was registered within the same time window.
 *
 * With the composite PK, this creates a new row with the OpenCode session ID
 * and deletes the old standalone row (if it was a temporary connectionId-based row).
 *
 * @param connectionId The MCP transport connectionId to find the existing row
 * @param newProviderSessionId The new provider session ID (e.g., OpenCode ses_xxx)
 * @param newProviderType The provider type for the new row, defaults to 'opencode'
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
    db.run(
      `DELETE FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`,
      [existing.providerType, existing.providerSessionId],
    );

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
    db.run(
      `UPDATE registered_connections
       SET updated_at = CURRENT_TIMESTAMP
       WHERE provider_type = ? AND provider_session_id = ?`,
      [newProviderType, newProviderSessionId],
    );
    persist();
  }
}

/**
 * @deprecated Use updateConnectionProviderSession instead.
 * Kept for backwards compatibility.
 */
export function updateConnectionOpenCodeSession(
  connectionId: string,
  openCodeSessionId: string,
): void {
  updateConnectionProviderSession(connectionId, openCodeSessionId, 'opencode');
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
  db.run(
    `UPDATE registered_connections
     SET base_directory = ?, updated_at = CURRENT_TIMESTAMP
     WHERE provider_type = ? AND provider_session_id = ?`,
    [baseDirectory, providerType, providerSessionId],
  );
  persist();
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
  db.run(
    `DELETE FROM registered_connections WHERE provider_type = ? AND provider_session_id = ?`,
    [providerType, providerSessionId],
  );
  persist();
}

// ─── Skills & Instructions ─────────────────────────────────────────────────

/**
 * Map a raw SQL row from `skills_and_instructions` to a `SkillOrInstruction`.
 * Column order: 0 id, 1 name, 2 type, 3 description, 4 content,
 *               5 category, 6 tags, 7 enabled, 8 is_builtin, 9 created_at, 10 updated_at
 */
function mapRowToSkillOrInstruction(row: SqlValue[]): SkillOrInstruction {
  const tagsRaw = row[6] as string | null;
  let tags: string[] | null = null;
  if (tagsRaw) {
    try {
      tags = JSON.parse(tagsRaw) as string[];
    } catch {
      tags = null;
    }
  }
  return {
    id: row[0] as number,
    name: row[1] as string,
    type: row[2] as 'skill' | 'instruction',
    description: row[3] as string,
    content: row[4] as string,
    category: row[5] as string | null,
    tags,
    enabled: (row[7] as number) === 1,
    isBuiltin: (row[8] as number) === 1,
    createdAt: row[9] as string,
    updatedAt: row[10] as string,
  };
}

/** Upsert a skill or instruction. If a record with the same name exists, it is updated. */
export function upsertSkillOrInstruction(data: {
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  category?: string | null;
  tags?: string[] | null;
}): SkillOrInstruction | null {
  if (!db) return null;
  const tagsJson = data.tags ? JSON.stringify(data.tags) : null;
  db.run(
    `INSERT INTO skills_and_instructions (name, type, description, content, category, tags)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       type = excluded.type,
       description = excluded.description,
       content = excluded.content,
       category = excluded.category,
       tags = excluded.tags,
       updated_at = CURRENT_TIMESTAMP`,
    [
      data.name,
      data.type,
      data.description,
      data.content,
      data.category ?? null,
      tagsJson,
    ],
  );
  persist();
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
  const query = `SELECT id, name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at
     FROM skills_and_instructions ${whereClause} ORDER BY name ASC`;

  const results = db.exec(query, params);
  if (results.length === 0) return [];
  return results[0].values.map(mapRowToSkillOrInstruction);
}

/** Get a single skill or instruction by name. */
export function getSkillOrInstructionByName(
  name: string,
): SkillOrInstruction | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT id, name, type, description, content, category, tags, enabled, is_builtin, created_at, updated_at
     FROM skills_and_instructions WHERE name = ?`,
    [name],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToSkillOrInstruction(results[0].values[0]);
}

/** Delete a skill or instruction by name. Returns true if a row was deleted. */
export function deleteSkillOrInstruction(name: string): boolean {
  if (!db) return false;
  const before = db.exec(
    `SELECT COUNT(*) FROM skills_and_instructions WHERE name = ?`,
    [name],
  );
  const existed = before.length > 0 && (before[0].values[0][0] as number) > 0;
  if (existed) {
    db.run(`DELETE FROM skills_and_instructions WHERE name = ?`, [name]);
    persist();
  }
  return existed;
}

/** Toggle the enabled status of a skill or instruction. Returns the updated record or null. */
export function toggleSkillOrInstructionEnabled(
  name: string,
  enabled: boolean,
): SkillOrInstruction | null {
  if (!db) return null;
  db.run(
    `UPDATE skills_and_instructions
     SET enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`,
    [enabled ? 1 : 0, name],
  );
  persist();
  return getSkillOrInstructionByName(name);
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

  db.run(
    `INSERT INTO skills_and_instructions (name, type, description, content, enabled)
     VALUES (?, ?, ?, ?, ?)`,
    [
      copyName,
      original.type,
      original.description,
      original.content,
      original.enabled ? 1 : 0,
    ],
  );
  persist();
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

  let insertedCount = 0;
  for (const template of templates) {
    // Check if template already exists
    const existing = db.exec(
      `SELECT 1 FROM skills_and_instructions WHERE name = ?`,
      [template.name],
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      continue; // Skip existing template
    }

    // Insert the built-in template
    db.run(
      `INSERT INTO skills_and_instructions (name, type, description, content, category, is_builtin, enabled)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [
        template.name,
        template.type,
        template.description,
        template.content,
        template.category,
      ],
    );
    insertedCount++;
  }

  if (insertedCount > 0) {
    persist();
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

  let resetCount = 0;
  for (const template of templates) {
    // Check if template already exists
    const existing = db.exec(
      `SELECT 1 FROM skills_and_instructions WHERE name = ?`,
      [template.name],
    );

    if (existing.length > 0 && existing[0].values.length > 0) {
      // Update existing template to reset it
      db.run(
        `UPDATE skills_and_instructions
         SET type = ?, description = ?, content = ?, category = ?, is_builtin = 1, enabled = 1, updated_at = CURRENT_TIMESTAMP
         WHERE name = ?`,
        [
          template.type,
          template.description,
          template.content,
          template.category,
          template.name,
        ],
      );
    } else {
      // Insert missing built-in template
      db.run(
        `INSERT INTO skills_and_instructions (name, type, description, content, category, is_builtin, enabled)
         VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [
          template.name,
          template.type,
          template.description,
          template.content,
          template.category,
        ],
      );
    }
    resetCount++;
  }

  if (resetCount > 0) {
    persist();
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
  const results = db.exec(
    `SELECT COUNT(*) FROM skills_and_instructions WHERE name IN (${placeholders})`,
    templateNames,
  );

  const existingCount =
    results.length > 0 ? (results[0].values[0][0] as number) : 0;
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
 * Queue a noReply context injection for delivery to a standalone (Copilot CLI)
 * agent. When `replaceKey` is provided, any existing undelivered injection with
 * the same (connectionId, replaceKey) is replaced — useful for doc context
 * (latest wins). Without `replaceKey`, a new row is always appended.
 */
export function upsertContextInjection(
  connectionId: string,
  payload: string,
  source = 'manual',
  replaceKey?: string,
): void {
  if (!db) return;
  if (replaceKey) {
    db.run(
      `DELETE FROM pending_context_injections
       WHERE connection_id = ? AND replace_key = ? AND delivered = 0`,
      [connectionId, replaceKey],
    );
  }
  db.run(
    `INSERT INTO pending_context_injections (connection_id, source, replace_key, payload)
     VALUES (?, ?, ?, ?)`,
    [connectionId, source, replaceKey ?? null, payload],
  );
  persist();
}

/**
 * Atomically claim and return all undelivered injections for a connection.
 * Marks them as delivered immediately. Safe in single-threaded Node.js/sql.js.
 */
export function claimContextInjections(
  connectionId: string,
): ContextInjection[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT id, source, payload, created_at
     FROM pending_context_injections
     WHERE connection_id = ? AND delivered = 0
     ORDER BY id ASC`,
    [connectionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return [];

  const items: ContextInjection[] = results[0].values.map((row) => ({
    id: row[0] as number,
    source: row[1] as string,
    payload: row[2] as string,
    createdAt: row[3] as string,
  }));

  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => '?').join(',');
  db.run(
    `UPDATE pending_context_injections SET delivered = 1 WHERE id IN (${placeholders})`,
    ids,
  );
  persist();
  return items;
}

/** Remove all context injections (delivered or not) for a connection. */
export function deleteContextInjectionsForConnection(
  connectionId: string,
): void {
  if (!db) return;
  db.run(`DELETE FROM pending_context_injections WHERE connection_id = ?`, [
    connectionId,
  ]);
  persist();
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
  const results = db.exec(
    `SELECT path, name, created_at FROM pinned_projects ORDER BY created_at DESC`,
  );
  if (results.length === 0) return [];
  return results[0].values.map((row) => ({
    path: row[0] as string,
    name: row[1] as string,
    createdAt: row[2] as string,
  }));
}

/** Add a pinned project. Returns true if added, false if already exists. */
export function addPinnedProject(path: string, name: string): boolean {
  if (!db) return false;
  try {
    db.run(`INSERT OR IGNORE INTO pinned_projects (path, name) VALUES (?, ?)`, [
      path,
      name,
    ]);
    persist();
    return true;
  } catch {
    return false;
  }
}

/** Remove a pinned project by path. */
export function removePinnedProject(path: string): boolean {
  if (!db) return false;
  db.run(`DELETE FROM pinned_projects WHERE path = ?`, [path]);
  persist();
  return true;
}

/** Check if a project path is pinned. */
export function isPinnedProject(path: string): boolean {
  if (!db) return false;
  const results = db.exec(
    `SELECT 1 FROM pinned_projects WHERE path = ? LIMIT 1`,
    [path],
  );
  return results.length > 0 && results[0].values.length > 0;
}
