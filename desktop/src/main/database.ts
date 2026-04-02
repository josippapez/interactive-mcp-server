import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

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
  messageType: 'question' | 'answer' | 'outbound';
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
  createdAt: string;
  updatedAt: string;
}

function persist(): void {
  if (!db) return;
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
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

  // Migration: add attachments column if missing (existing databases)
  try {
    db.exec('SELECT attachments FROM conversations LIMIT 0');
  } catch {
    db.run('ALTER TABLE conversations ADD COLUMN attachments TEXT');
  }

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
  messageType: 'question' | 'answer' | 'outbound';
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
    messageType: row[2] as 'question' | 'answer' | 'outbound',
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
}[] {
  if (!db) return [];
  const results = db.exec(
    `SELECT session_id, label, created_at FROM session_channels ORDER BY created_at ASC`,
  );
  if (results.length === 0) return [];
  return results[0].values.map((row) => ({
    sessionId: row[0] as string,
    label: row[1] as string | null,
    createdAt: row[2] as string,
  }));
}

// ─── Registered connections ───

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
      }),
      'utf-8',
    );
  } catch {
    // non-critical — DB is the source of truth
  }

  if (db) {
    db.run(
      `INSERT INTO registered_connections
         (connection_id, agent_name, project_name, base_directory, id_file_path, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(connection_id) DO UPDATE SET
         agent_name = excluded.agent_name,
         project_name = excluded.project_name,
         base_directory = excluded.base_directory,
         id_file_path = excluded.id_file_path,
         updated_at = CURRENT_TIMESTAMP`,
      [
        data.connectionId,
        data.agentName,
        data.projectName,
        data.baseDirectory ?? null,
        idFilePath,
      ],
    );
    persist();
  }

  return idFilePath;
}

/** Look up a registered connection by connectionId. */
export function getRegisteredConnection(
  connectionId: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT connection_id, agent_name, project_name, base_directory, id_file_path, created_at, updated_at
     FROM registered_connections WHERE connection_id = ?`,
    [connectionId],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  const row = results[0].values[0];
  return {
    connectionId: row[0] as string,
    agentName: row[1] as string,
    projectName: row[2] as string,
    baseDirectory: row[3] as string | null,
    idFilePath: row[4] as string,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  };
}

/** Look up a registered connection by agent name. */
export function getRegisteredConnectionByName(
  agentName: string,
): RegisteredConnection | null {
  if (!db) return null;
  const results = db.exec(
    `SELECT connection_id, agent_name, project_name, base_directory, id_file_path, created_at, updated_at
     FROM registered_connections WHERE agent_name = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [agentName],
  );
  if (results.length === 0 || results[0].values.length === 0) return null;
  const row = results[0].values[0];
  return {
    connectionId: row[0] as string,
    agentName: row[1] as string,
    projectName: row[2] as string,
    baseDirectory: row[3] as string | null,
    idFilePath: row[4] as string,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  };
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
