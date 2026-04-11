/**
 * Session-tree poller.
 *
 * Every POLL_INTERVAL_MS the poller:
 * 1. Fetches all sessions from the OpenCode ACP API.
 * 2. For every registered connection that has an openCodeSessionId, walks the
 *    descendant tree (via parentID chains) in the fetched session list.
 * 3. Fires a `child-sessions-detected` IPC event to the renderer for any
 *    descendant OpenCode sessions that are not yet represented by a registered
 *    connection in the app AND were created recently (within RECENT_WINDOW_MS).
 *
 * The recency filter prevents old/dead subagent sessions from past work
 * sessions being turned into placeholder entries every time the app restarts.
 *
 * This lets the sidebar show placeholder entries for subagents before they call
 * register_connection themselves.
 */

import type { BrowserWindow } from 'electron';
import { getAllRegisteredConnections } from '../database';
import {
  fetchAllOpenCodeSessions,
  collectDescendants,
  type OpenCodeSession,
} from '../opencode/session';

const POLL_INTERVAL_MS = 4_000;

/**
 * Only treat a child session as "new" if it was created within this window.
 * Sessions older than this are assumed to be dead subagents from past work
 * and are not surfaced as placeholders.
 */
const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/** One placeholder entry sent to the renderer. */
export interface DetectedChildSession {
  /** OpenCode session ID of the child. */
  openCodeSessionId: string;
  /** OpenCode session ID of the direct parent. */
  parentOpenCodeSessionId: string;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start polling. Safe to call multiple times — subsequent calls are no-ops
 * until stopSessionTreePoller() is called.
 */
export function startSessionTreePoller(
  getWindow: () => BrowserWindow | null,
  getOpenCodePort: () => number,
): void {
  if (pollTimer !== null) return;

  const tick = async (): Promise<void> => {
    const win = getWindow();
    if (!win) return;

    const allSessions = await fetchAllOpenCodeSessions(getOpenCodePort());
    if (!allSessions || allSessions.length === 0) return;

    const registeredConnections = getAllRegisteredConnections();

    // Build a set of all openCodeSessionIds already known to the app so we
    // don't fire events for sessions that are already tracked.
    const knownOpenCodeIds = new Set<string>(
      registeredConnections
        .map((c) => c.openCodeSessionId)
        .filter((id): id is string => id !== null),
    );

    const now = Date.now();
    const newChildren: DetectedChildSession[] = [];

    for (const conn of registeredConnections) {
      if (!conn.openCodeSessionId) continue;
      // Walk all descendants of this connection's OpenCode session
      const descendants = collectDescendants(
        conn.openCodeSessionId,
        allSessions,
      );
      for (const child of descendants) {
        if (knownOpenCodeIds.has(child.id)) continue;

        // Skip old sessions — they're likely dead subagents from previous work.
        const createdAt = child.time?.created ?? 0;
        if (createdAt > 0 && now - createdAt > RECENT_WINDOW_MS) continue;

        // Resolve the direct parent ID (may be the registered session or an
        // intermediate ancestor that is also a new child).
        const directParentId = child.parentID ?? conn.openCodeSessionId;
        newChildren.push({
          openCodeSessionId: child.id,
          parentOpenCodeSessionId: directParentId,
        });
        // Add to known set so siblings don't double-fire within this tick
        knownOpenCodeIds.add(child.id);
      }
    }

    if (newChildren.length > 0) {
      win.webContents.send('child-sessions-detected', newChildren);
    }
  };

  // Run immediately on start, then on interval
  void tick();
  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

/** Stop polling and clean up the timer. */
export function stopSessionTreePoller(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
