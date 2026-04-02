import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

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
