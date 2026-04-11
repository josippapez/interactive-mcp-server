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

/** A single SQL column value as returned by sql.js query results. */
type SqlValue = string | number | Uint8Array | null;

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
  const results = db.exec(
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
    [searchPattern, searchPattern, searchPattern, searchPattern, limit],
  );

  if (results.length === 0 || results[0].values.length === 0) {
    return [];
  }

  return results[0].values.map((row: SqlValue[]) => ({
    sessionId: row[0] as string,
    channelName: row[1] as string,
    projectName: row[2] as string,
    createdAt: row[3] as string,
    updatedAt: row[4] as string,
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
  const results = db.exec(
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
    [searchPattern, limit],
  );

  if (results.length === 0 || results[0].values.length === 0) {
    return [];
  }

  return results[0].values.map((row: SqlValue[]) => {
    const messageText = row[4] as string;
    return {
      id: row[0] as number,
      sessionId: row[1] as string,
      sessionName: (row[2] as string) || (row[1] as string),
      messageType: row[3] as MessageSearchResult['messageType'],
      messageText,
      snippet: createSnippet(messageText, query),
      createdAt: row[5] as string,
    };
  });
}
