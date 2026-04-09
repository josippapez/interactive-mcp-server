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
const SCHEMA_VERSION = 2;

// ─── Public interfaces ─────────────────────────────────────────────────────

export interface SkillOrInstruction {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
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
  connectionId: string;
  channelName: string;
  projectName: string;
  baseDirectory: string | null;
  idFilePath: string;
  openCodeSessionId: string | null;
  parentSessionId: string | null;
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
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS registered_connections (
      connection_id        TEXT     PRIMARY KEY,
      agent_name           TEXT     NOT NULL,
      project_name         TEXT     NOT NULL,
      base_directory       TEXT,
      id_file_path         TEXT     NOT NULL,
      open_code_session_id TEXT,
      parent_session_id    TEXT,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Map a raw SQL row (9 columns) from `registered_connections` to a
 * `RegisteredConnection` object. Column order must match every SELECT that
 * queries this table:
 *   0 connection_id, 1 agent_name, 2 project_name, 3 base_directory,
 *   4 id_file_path, 5 open_code_session_id, 6 parent_session_id,
 *   7 created_at, 8 updated_at
 */
function mapRowToRegisteredConnection(row: SqlValue[]): RegisteredConnection {
  return {
    connectionId: row[0] as string,
    channelName: row[1] as string,
    projectName: row[2] as string,
    baseDirectory: row[3] as string | null,
    idFilePath: row[4] as string,
    openCodeSessionId: row[5] as string | null,
    parentSessionId: row[6] as string | null,
    createdAt: row[7] as string,
    updatedAt: row[8] as string,
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
            rc.open_code_session_id, rc.parent_session_id
     FROM session_channels sc
     LEFT JOIN registered_connections rc ON rc.connection_id = sc.session_id
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

/** Path for a per-agent connection ID file in /tmp. */
export function agentIdFilePath(
  channelName: string,
  openCodeSessionId?: string,
  connectionId?: string,
): string {
  const safe = channelName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const identityRaw = openCodeSessionId ?? connectionId ?? 'main';
  const identity = identityRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return join(tmpdir(), `imcp-agent-${safe}-${identity}.json`);
}

/**
 * Upsert a registered connection. Writes the ID file to /tmp and persists
 * the record to the database.
 *
 * Deduplication: when the same agent reconnects with a new transport UUID
 * (new connectionId), existing history and queued messages from old
 * connections with the same (channelName, openCodeSessionId) pair are re-keyed
 * to the new connectionId. Old session_channels and registered_connections
 * rows are then cleaned up.
 *
 * Two rows with the same channelName but *different* non-null
 * openCodeSessionIds are distinct agent instances (e.g. root and subagent
 * both named "Claude Code") and are NOT deduplicated against each other.
 */
export function upsertRegisteredConnection(data: {
  connectionId: string;
  channelName: string;
  projectName: string;
  baseDirectory?: string;
  openCodeSessionId?: string;
  parentSessionId?: string;
}): string {
  const idFilePath = agentIdFilePath(
    data.channelName,
    data.openCodeSessionId,
    data.connectionId,
  );

  // Write ID file so agents can read their connectionId back on restart
  try {
    writeFileSync(
      idFilePath,
      JSON.stringify({
        connectionId: data.connectionId,
        channelName: data.channelName,
        projectName: data.projectName,
        baseDirectory: data.baseDirectory ?? null,
        openCodeSessionId: data.openCodeSessionId ?? null,
        parentSessionId: data.parentSessionId ?? null,
      }),
      'utf-8',
    );
  } catch {
    // non-critical — DB is the source of truth
  }

  if (db) {
    // Match condition: both have no session ID, OR both share the same
    // non-null session ID. Any cross-session combination is left alone.
    const newSessionId = data.openCodeSessionId ?? null;
    const sameSessionFilter = `(
      (? IS NULL AND open_code_session_id IS NULL)
      OR
      (? IS NOT NULL AND open_code_session_id = ?)
    )`;
    // dedupeParams for UPDATE queries:
    // [newConnId, channelName, newConnId, newSesId, newSesId, newSesId]
    const dedupeParams = [
      data.connectionId,
      data.channelName,
      data.connectionId,
      newSessionId,
      newSessionId,
      newSessionId,
    ];
    db.run(
      `UPDATE session_channel_history
       SET session_id = ?
       WHERE session_id IN (
         SELECT connection_id FROM registered_connections
         WHERE agent_name = ? AND connection_id != ?
           AND ${sameSessionFilter}
       )`,
      dedupeParams,
    );
    db.run(
      `UPDATE session_messages
       SET session_id = ?
       WHERE session_id IN (
         SELECT connection_id FROM registered_connections
         WHERE agent_name = ? AND connection_id != ?
           AND ${sameSessionFilter}
       )`,
      dedupeParams,
    );
    db.run(
      `DELETE FROM session_channels
       WHERE session_id IN (
         SELECT connection_id FROM registered_connections
         WHERE agent_name = ? AND connection_id != ?
           AND ${sameSessionFilter}
       )`,
      [
        data.channelName,
        data.connectionId,
        newSessionId,
        newSessionId,
        newSessionId,
      ],
    );
    db.run(
      `DELETE FROM registered_connections
       WHERE agent_name = ? AND connection_id != ?
         AND ${sameSessionFilter}`,
      [
        data.channelName,
        data.connectionId,
        newSessionId,
        newSessionId,
        newSessionId,
      ],
    );

    db.run(
      `INSERT INTO registered_connections
         (connection_id, agent_name, project_name, base_directory, id_file_path, open_code_session_id, parent_session_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(connection_id) DO UPDATE SET
         agent_name = excluded.agent_name,
         project_name = excluded.project_name,
         base_directory = excluded.base_directory,
         id_file_path = excluded.id_file_path,
         open_code_session_id = excluded.open_code_session_id,
         parent_session_id = excluded.parent_session_id,
         updated_at = CURRENT_TIMESTAMP`,
      [
        data.connectionId,
        data.channelName,
        data.projectName,
        data.baseDirectory ?? null,
        idFilePath,
        data.openCodeSessionId ?? null,
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
    `SELECT connection_id, agent_name, project_name, base_directory, id_file_path, open_code_session_id, parent_session_id, created_at, updated_at
     FROM registered_connections ORDER BY created_at ASC`,
  );
  if (results.length === 0) return [];
  return results[0].values.map(mapRowToRegisteredConnection);
}

/** Look up a registered connection by connectionId. */
export function getRegisteredConnection(
  connectionId: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT connection_id, agent_name, project_name, base_directory, id_file_path, open_code_session_id, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE connection_id = ?`,
    [connectionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToRegisteredConnection(results[0].values[0]);
}

/** Look up a registered connection by channel name. */
export function getRegisteredConnectionByName(
  channelName: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT connection_id, agent_name, project_name, base_directory, id_file_path, open_code_session_id, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE agent_name = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [channelName],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return mapRowToRegisteredConnection(results[0].values[0]);
}

/**
 * Returns true if the given openCodeSessionId is already claimed by a
 * registered connection OTHER than `excludingConnectionId`.
 *
 * Used during register_connection auto-detection: if the detected session is
 * already owned by another connection (e.g. the root agent), a subagent must
 * NOT bind itself to that same session — doing so would route the subagent's
 * prompts to the root channel.
 */
export function isOpenCodeSessionClaimed(
  openCodeSessionId: string,
  excludingConnectionId: string,
): boolean {
  if (!db) return false;
  const results = db.exec(
    `SELECT 1 FROM registered_connections
     WHERE open_code_session_id = ? AND connection_id != ?
     LIMIT 1`,
    [openCodeSessionId, excludingConnectionId],
  );
  return results.length > 0 && results[0].values.length > 0;
}

/**
 * Returns the connectionId of the connection that is currently claiming
 * the given openCodeSessionId, excluding `excludingConnectionId`.
 *
 * Returns null if no other connection claims the session.
 */
export function getConnectionClaimingSession(
  openCodeSessionId: string,
  excludingConnectionId: string,
): string | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT connection_id FROM registered_connections
     WHERE open_code_session_id = ? AND connection_id != ?
     LIMIT 1`,
    [openCodeSessionId, excludingConnectionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  return results[0].values[0][0] as string;
}

/**
 * Clear the openCodeSessionId for a connection (set to NULL).
 * Used to release a stale session claim so a new connection can take over.
 */
export function clearConnectionOpenCodeSession(connectionId: string): void {
  if (!db) return;
  db.run(
    `UPDATE registered_connections
     SET open_code_session_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE connection_id = ?`,
    [connectionId],
  );
  persist();
}

/**
 * Patch the openCodeSessionId on an existing registered connection.
 * Used by the SSE auto-bind logic to attach a just-created OpenCode child
 * session to the MCP connection that was registered within the same time window.
 */
export function updateConnectionOpenCodeSession(
  connectionId: string,
  openCodeSessionId: string,
): void {
  if (!db) return;
  db.run(
    `UPDATE registered_connections
     SET open_code_session_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE connection_id = ?`,
    [openCodeSessionId, connectionId],
  );
  persist();
}

/**
 * Delete a registered connection from the DB and remove the ID file from disk.
 * Called when the user removes a session from the UI.
 */
export function deleteRegisteredConnection(connectionId: string): void {
  if (!db) return;
  const rec = getRegisteredConnection(connectionId);
  if (rec) {
    try {
      unlinkSync(rec.idFilePath);
    } catch {
      // file may already be gone
    }
  }
  db.run(`DELETE FROM registered_connections WHERE connection_id = ?`, [
    connectionId,
  ]);
  persist();
}

// ─── Skills & Instructions ─────────────────────────────────────────────────

/**
 * Map a raw SQL row from `skills_and_instructions` to a `SkillOrInstruction`.
 * Column order: 0 id, 1 name, 2 type, 3 description, 4 content,
 *               5 created_at, 6 updated_at
 */
function mapRowToSkillOrInstruction(row: SqlValue[]): SkillOrInstruction {
  return {
    id: row[0] as number,
    name: row[1] as string,
    type: row[2] as 'skill' | 'instruction',
    description: row[3] as string,
    content: row[4] as string,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  };
}

/** Upsert a skill or instruction. If a record with the same name exists, it is updated. */
export function upsertSkillOrInstruction(data: {
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
}): SkillOrInstruction | null {
  if (!db) return null;
  db.run(
    `INSERT INTO skills_and_instructions (name, type, description, content)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       type = excluded.type,
       description = excluded.description,
       content = excluded.content,
       updated_at = CURRENT_TIMESTAMP`,
    [data.name, data.type, data.description, data.content],
  );
  persist();
  return getSkillOrInstructionByName(data.name);
}

/** List all skills and instructions, optionally filtered by type. */
export function listSkillsAndInstructions(
  filterType?: 'skill' | 'instruction',
): SkillOrInstruction[] {
  if (!db) return [];
  const query = filterType
    ? `SELECT id, name, type, description, content, created_at, updated_at
       FROM skills_and_instructions WHERE type = ? ORDER BY name ASC`
    : `SELECT id, name, type, description, content, created_at, updated_at
       FROM skills_and_instructions ORDER BY name ASC`;
  const params = filterType ? [filterType] : [];
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
    `SELECT id, name, type, description, content, created_at, updated_at
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
