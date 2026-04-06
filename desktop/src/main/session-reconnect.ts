/**
 * Reconcile persisted registered_connections with live OpenCode sessions.
 *
 * Called once on startup after the session tree manager is initialized.
 * Removes stale entries from the database where the OpenCode session
 * no longer exists, keeping our local state in sync.
 */

import {
  getAllRegisteredConnections,
  deleteRegisteredConnection,
} from './database';
import { fetchAllOpenCodeSessions } from './opencode-session';

export interface ReconnectResult {
  /** Number of persisted connections that matched a live OpenCode session. */
  matched: number;
  /** Number of stale connections removed from the database. */
  cleaned: number;
  /** Total persisted connections examined. */
  total: number;
}

export async function reconcileSessionConnections(
  openCodePort: number,
): Promise<ReconnectResult> {
  const registeredConnections = getAllRegisteredConnections();
  const total = registeredConnections.length;

  const fallbackDirectories = Array.from(
    new Set(
      registeredConnections
        .map((conn) => conn.baseDirectory)
        .filter((dir): dir is string => !!dir && dir.trim().length > 0),
    ),
  );

  const allSessions = await fetchAllOpenCodeSessions(
    openCodePort,
    fallbackDirectories,
  );

  // If OpenCode API is unreachable, don't clean anything — we can't verify.
  if (!allSessions) {
    return { matched: 0, cleaned: 0, total };
  }

  // Build a Set of live session IDs for O(1) lookups.
  const liveSessionIds = new Set(allSessions.map((s) => s.id));

  let matched = 0;
  let cleaned = 0;

  for (const conn of registeredConnections) {
    // Skip connections without an openCodeSessionId — nothing to reconcile.
    if (!conn.openCodeSessionId) continue;

    if (liveSessionIds.has(conn.openCodeSessionId)) {
      matched++;
      console.log(
        `[session-reconnect] matched connection "${conn.agentName}" (${conn.connectionId}) → session ${conn.openCodeSessionId}`,
      );
    } else {
      deleteRegisteredConnection(conn.connectionId);
      cleaned++;
      console.log(
        `[session-reconnect] cleaned stale connection "${conn.agentName}" (${conn.connectionId}) — session ${conn.openCodeSessionId} no longer exists`,
      );
    }
  }

  return { matched, cleaned, total };
}
