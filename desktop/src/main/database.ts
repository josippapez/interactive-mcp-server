import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

/** A single SQL column value as returned by sql.js query results. */
type SqlValue = string | number | Uint8Array | null;

let db: SqlJsDatabase | null = null;
let dbPath = '';

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
  agentName: string;
  projectName: string;
  baseDirectory: string | null;
  idFilePath: string;
  openCodeSessionId: string | null;
  parentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

function persist(): void {
  if (!db) return;
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

/**
 * Apply all incremental schema migrations in order. Each block is idempotent:
 * ALTER TABLE probes are guarded by a try/catch SELECT, and data-fix DML is
 * safe to run on already-migrated databases.
 *
 * Add new migrations at the bottom with a comment marking the version/purpose.
 * Do NOT reorder or remove existing blocks.
 */
function runMigrations(): void {
  if (!db) return;

  // v1 — add attachments column to conversations
  try {
    db.exec('SELECT attachments FROM conversations LIMIT 0');
  } catch {
    db.run('ALTER TABLE conversations ADD COLUMN attachments TEXT');
  }

  // v2 — add open_code_session_id column to registered_connections
  try {
    db.exec('SELECT open_code_session_id FROM registered_connections LIMIT 0');
  } catch {
    db.run(
      'ALTER TABLE registered_connections ADD COLUMN open_code_session_id TEXT',
    );
  }

  // v3 — add parent_session_id column to registered_connections
  try {
    db.exec('SELECT parent_session_id FROM registered_connections LIMIT 0');
  } catch {
    db.run(
      'ALTER TABLE registered_connections ADD COLUMN parent_session_id TEXT',
    );
  }

  // v4 — clear stale open_code_session_id for connections registered without a
  // base_directory. These received a stale auto-detected session ID from a
  // different agent, causing injected messages to land in the wrong session.
  // With the updated register_connection logic, such channels will no longer
  // auto-detect at all — this migration retroactively fixes existing records.
  db.run(
    `UPDATE registered_connections
     SET open_code_session_id = NULL, parent_session_id = NULL
     WHERE (base_directory IS NULL OR base_directory = '')
       AND open_code_session_id IS NOT NULL`,
  );

  // v5 — deduplicate registered_connections by agent_name.
  // Each restart previously created a new row (new transport UUID → new PK).
  // Keep the most-recently-updated row per (agent_name, open_code_session_id)
  // group; delete older duplicates within the same group only.
  //
  // NOTE: Two rows with the same agent_name but *different* non-null
  // open_code_session_ids belong to distinct agent instances (e.g. root and
  // subagent both named "Claude Code"). They MUST NOT be deduplicated against
  // each other — doing so would orphan one agent from the snapshot index and
  // cause its prompts to be silently dropped.
  db.run(
    `DELETE FROM registered_connections
     WHERE connection_id NOT IN (
       SELECT connection_id FROM registered_connections rc2
       WHERE rc2.agent_name = registered_connections.agent_name
         AND (
           rc2.open_code_session_id IS NULL AND registered_connections.open_code_session_id IS NULL
           OR rc2.open_code_session_id = registered_connections.open_code_session_id
         )
       ORDER BY rc2.updated_at DESC
       LIMIT 1
     )`,
  );

  // v6 — remove orphaned session_channels rows.
  // These are channels created during handleTransparentReinit (labelled "Agent N")
  // that were never claimed by a register_connection call, so they have no
  // matching registered_connections entry and appear as ghost top-level channels.
  db.run(
    `DELETE FROM session_channel_history
     WHERE session_id IN (
       SELECT sc.session_id FROM session_channels sc
       LEFT JOIN registered_connections rc ON rc.connection_id = sc.session_id
       WHERE rc.connection_id IS NULL
     )`,
  );
  db.run(
    `DELETE FROM session_messages
     WHERE session_id IN (
       SELECT sc.session_id FROM session_channels sc
       LEFT JOIN registered_connections rc ON rc.connection_id = sc.session_id
       WHERE rc.connection_id IS NULL
     )`,
  );
  db.run(
    `DELETE FROM session_channels
     WHERE session_id NOT IN (
       SELECT connection_id FROM registered_connections
     )`,
  );
}

export async function initDatabase(): Promise<void> {
  dbPath = join(app.getPath('userData'), 'conversations.db');

  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // ── 1. Base DDL ──────────────────────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_message TEXT NOT NULL,
      project_name TEXT NOT NULL,
      user_response TEXT NOT NULL,
      predefined_options TEXT,
      attachments TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_channels (
      session_id TEXT PRIMARY KEY,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      message TEXT NOT NULL,
      sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_channel_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      message_text TEXT NOT NULL,
      attachments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Registered connections — named agent registrations with ID file tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS registered_connections (
      connection_id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      project_name TEXT NOT NULL,
      base_directory TEXT,
      id_file_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── 2. Migrations ─────────────────────────────────────────────────────────
  runMigrations();

  // ── 3. Persist ────────────────────────────────────────────────────────────
  persist();
}

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

// ─── Session channel functions ───

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

// ─── Registered connections ───

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
    agentName: row[1] as string,
    projectName: row[2] as string,
    baseDirectory: row[3] as string | null,
    idFilePath: row[4] as string,
    openCodeSessionId: row[5] as string | null,
    parentSessionId: row[6] as string | null,
    createdAt: row[7] as string,
    updatedAt: row[8] as string,
  };
}

/** Path for a per-agent connection ID file in /tmp. */
export function agentIdFilePath(agentName: string): string {
  const safe = agentName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return join(tmpdir(), `imcp-agent-${safe}.json`);
}

/**
 * Upsert a registered connection. Writes the ID file to /tmp and persists
 * the record to the database.
 */
export function upsertRegisteredConnection(data: {
  connectionId: string;
  agentName: string;
  projectName: string;
  baseDirectory?: string;
  openCodeSessionId?: string;
  parentSessionId?: string;
}): string {
  const idFilePath = agentIdFilePath(data.agentName);

  // Write ID file so agents can read their connectionId back on restart
  try {
    writeFileSync(
      idFilePath,
      JSON.stringify({
        connectionId: data.connectionId,
        agentName: data.agentName,
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
    // When the same agent reconnects with a new transport UUID (new connectionId),
    // re-key any existing history and queued messages from the old connection(s)
    // to the new connectionId so history is preserved across restarts.
    // session_channels and registered_connections rows for the old IDs are
    // cleaned up below — only the content tables are migrated, not the PKs.
    //
    // IMPORTANT: Only deduplicate rows that represent the *same* agent instance
    // (same openCodeSessionId, or no openCodeSessionId on either side). Two rows
    // with different non-null openCodeSessionIds are distinct agent instances that
    // happen to share a display name (e.g. both root and subagent are named
    // "Claude Code"). Deleting the root's row would orphan it from the snapshot
    // index and cause its prompts to be dropped.
    //
    // Match condition: both have no session ID, OR both share the same non-null
    // session ID. Any cross-session combination is left alone.
    const newSessionId = data.openCodeSessionId ?? null;
    const sameSessionFilter = `(
      (? IS NULL AND open_code_session_id IS NULL)
      OR
      (? IS NOT NULL AND open_code_session_id = ?)
    )`;
    // dedupeParams for UPDATE queries: [newConnId, agentName, newConnId, newSesId, newSesId, newSesId]
    const dedupeParams = [
      data.connectionId,
      data.agentName,
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
        data.agentName,
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
        data.agentName,
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
        data.agentName,
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

/** Look up a registered connection by agent name. */
export function getRegisteredConnectionByName(
  agentName: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT connection_id, agent_name, project_name, base_directory, id_file_path, open_code_session_id, parent_session_id, created_at, updated_at
     FROM registered_connections WHERE agent_name = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [agentName],
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
