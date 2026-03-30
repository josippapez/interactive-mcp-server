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
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  persist();
}

export function saveConversation(data: {
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions?: string[];
}): void {
  if (!db) return;

  db.run(
    `INSERT INTO conversations (prompt_message, project_name, user_response, predefined_options)
     VALUES (?, ?, ?, ?)`,
    [
      data.promptMessage,
      data.projectName,
      data.userResponse,
      data.predefinedOptions ? JSON.stringify(data.predefinedOptions) : null,
    ],
  );
  persist();
}

export function getConversationHistory(limit = 100): ConversationRecord[] {
  if (!db) return [];

  const results = db.exec(
    `SELECT id, prompt_message, project_name, user_response, predefined_options, created_at
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
    createdAt: row[5] as string,
  }));
}

export function clearHistory(): void {
  if (!db) return;
  db.run('DELETE FROM conversations');
  persist();
}
