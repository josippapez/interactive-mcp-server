/**
 * Global search functionality for searching across all sessions and messages.
 * Used by the GlobalSearch component via IPC.
 */

import { getDbInstance } from '../database';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SessionSearchResult {
  sessionId: string;
  channelName: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageSearchResult {
  id: number;
  sessionId: string;
  sessionName: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  snippet: string;
  createdAt: string;
}

export interface GlobalSearchResult {
  sessions: SessionSearchResult[];
  messages: MessageSearchResult[];
}

export interface SearchOptions {
  sessionLimit?: number;
  messageLimit?: number;
}

// ─── Helper functions ──────────────────────────────────────────────────────

/**
 * Create a snippet from message text with context around the match.
 * Returns up to 150 characters centered around the first match.
 */
function createSnippet(text: string, query: string): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    // No match found, return start of text
    return text.length > 150 ? text.slice(0, 147) + '...' : text;
  }

  const snippetLength = 150;
  const contextBefore = 50;

  let start = Math.max(0, matchIndex - contextBefore);
  const end = Math.min(text.length, start + snippetLength);

  // Adjust start if we're near the end
  if (end === text.length && end - start < snippetLength) {
    start = Math.max(0, end - snippetLength);
  }

  let snippet = text.slice(start, end);

  // Add ellipsis if truncated
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < text.length) {
    snippet = snippet + '...';
  }

  return snippet;
}

// ─── Main search function ──────────────────────────────────────────────────

/**
 * Search across all sessions and messages.
 * Returns results grouped by type with configurable limits.
 */
export function searchGlobal(
  query: string,
  options: SearchOptions = {},
): GlobalSearchResult {
  const { sessionLimit = 20, messageLimit = 20 } = options;

  // Handle empty or whitespace-only queries
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { sessions: [], messages: [] };
  }

  const db = getDbInstance();
  if (!db) {
    return { sessions: [], messages: [] };
  }

  const sessions = searchSessions(db, trimmedQuery, sessionLimit);
  const messages = searchMessages(db, trimmedQuery, messageLimit);

  return { sessions, messages };
}

// ─── Row shapes returned by better-sqlite3 ────────────────────────────────

interface SessionSearchRow {
  session_id: string;
  channel_name: string;
  project_name: string;
  created_at: string;
  updated_at: string;
}

interface MessageSearchRow {
  id: number;
  session_id: string;
  session_name: string | null;
  message_type: MessageSearchResult['messageType'];
  message_text: string;
  created_at: string;
}

/**
 * Search sessions by channel name or project name.
 */
function searchSessions(
  db: ReturnType<typeof getDbInstance>,
  query: string,
  limit: number,
): SessionSearchResult[] {
  if (!db) return [];

  const searchPattern = `%${query}%`;

  // Join session_channels with registered_connections to get full metadata
  // Order by most recent first (created_at DESC)
  const rows = db
    .prepare(
      `SELECT 
         sc.session_id,
         COALESCE(rc.agent_name, sc.label, sc.session_id) as channel_name,
         COALESCE(rc.project_name, '') as project_name,
         sc.created_at,
         COALESCE(rc.updated_at, sc.created_at) as updated_at
       FROM session_channels sc
       LEFT JOIN registered_connections rc ON rc.provider_session_id = sc.session_id
       WHERE (
         sc.label LIKE ? COLLATE NOCASE
         OR sc.session_id LIKE ? COLLATE NOCASE
         OR rc.agent_name LIKE ? COLLATE NOCASE
         OR rc.project_name LIKE ? COLLATE NOCASE
       )
       ORDER BY COALESCE(rc.updated_at, sc.created_at) DESC
       LIMIT ?`,
    )
    .all(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      limit,
    ) as SessionSearchRow[];

  return rows.map((row) => ({
    sessionId: row.session_id,
    channelName: row.channel_name,
    projectName: row.project_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Search messages by content.
 */
function searchMessages(
  db: ReturnType<typeof getDbInstance>,
  query: string,
  limit: number,
): MessageSearchResult[] {
  if (!db) return [];

  const searchPattern = `%${query}%`;

  // Join with session_channels to get session name
  // Also join with registered_connections for better channel names
  const rows = db
    .prepare(
      `SELECT 
         sch.id,
         sch.session_id,
         COALESCE(rc.agent_name, sc.label, sch.session_id) as session_name,
         sch.message_type,
         sch.message_text,
         sch.created_at
       FROM session_channel_history sch
       LEFT JOIN session_channels sc ON sc.session_id = sch.session_id
       LEFT JOIN registered_connections rc ON rc.provider_session_id = sch.session_id
       WHERE sch.message_text LIKE ? COLLATE NOCASE
       ORDER BY sch.created_at DESC
       LIMIT ?`,
    )
    .all(searchPattern, limit) as MessageSearchRow[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sessionName: row.session_name || row.session_id,
    messageType: row.message_type,
    messageText: row.message_text,
    snippet: createSnippet(row.message_text, query),
    createdAt: row.created_at,
  }));
}
