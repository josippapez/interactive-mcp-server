/**
 * Reconcile persisted registered_connections with live OpenCode sessions.
 *
 * Called once on startup after the session tree manager is initialized,
 * and again when the user changes the selected folder in the sidebar.
 * Removes stale entries from the database where the OpenCode session
 * no longer exists under the selected folder, keeping our local state in sync.
 *
 * Per the per-folder session view, reconciliation is scoped to the currently
 * selected folder. Connections that belong to *other* folders are left alone
 * (they'll be reconciled when the user selects their folder). When no folder
 * is selected, reconciliation is a no-op.
 */

import {
  getAllRegisteredConnections,
  deleteRegisteredConnection,
} from './database';
import { fetchSessionsForDirectory } from './session';

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
  baseDirectory: string | null,
): Promise<ReconnectResult> {
  const registeredConnections = getAllRegisteredConnections();
  const total = registeredConnections.length;

  // No folder selected — defer reconciliation until the user picks one.
  if (!baseDirectory) {
    return { matched: 0, cleaned: 0, total };
  }

  const trimmedDirectory = baseDirectory.trim();
  if (trimmedDirectory.length === 0) {
    return { matched: 0, cleaned: 0, total };
  }

  // Only reconcile connections registered under the selected folder; leave
  // other folders' connections untouched until the user visits them.
  const scopedConnections = registeredConnections.filter(
    (conn) => conn.baseDirectory?.trim() === trimmedDirectory,
  );

  const allSessions = await fetchSessionsForDirectory(
    openCodePort,
    trimmedDirectory,
  );

  // If OpenCode API is unreachable, don't clean anything — we can't verify.
  if (!allSessions) {
    return { matched: 0, cleaned: 0, total };
  }

  // Build a Set of live session IDs for O(1) lookups.
  const liveSessionIds = new Set(allSessions.map((s) => s.id));

  let matched = 0;
  let cleaned = 0;

  for (const conn of scopedConnections) {
    // Skip connections without a providerSessionId — nothing to reconcile.
    if (!conn.providerSessionId) continue;

    if (liveSessionIds.has(conn.providerSessionId)) {
      matched++;
      console.log(
        `[session-reconnect] matched connection "${conn.channelName}" (${conn.connectionId}) → session ${conn.providerSessionId}`,
      );
    } else {
      deleteRegisteredConnection(conn.providerSessionId, conn.providerType);
      cleaned++;
      console.log(
        `[session-reconnect] cleaned stale connection "${conn.channelName}" (${conn.connectionId}) — session ${conn.providerSessionId} no longer exists`,
      );
    }
  }

  return { matched, cleaned, total };
}
