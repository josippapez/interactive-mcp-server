/**
 * Initial REST seed: populate the in-memory cache with sessions currently
 * known to OpenCode on startup and on manual refresh.
 */

import { getAllRegisteredConnections } from '../../database';
import { fetchAllOpenCodeSessions } from '../../opencode/session';
import { autoRegisterSession } from './auto-register';
import { scheduleSnapshot } from './snapshot';
import { _sessionCache, _tombstonedSessionIds, state } from './state';
import type { SessionInfo } from './types';

/**
 * Seed the in-memory cache with all sessions currently known to OpenCode.
 * Called once after the SSE connection is established so that sessions created
 * before this app session started are immediately visible.
 *
 * If the API is unreachable (returns null), the cache stays empty and the app
 * renders as-is — the user will see sessions appear as new events arrive.
 */
export async function seedCacheFromRest(
  openCodePort: number,
  force = false,
): Promise<void> {
  if (state.restSeedCompleted && !force) return;

  const fallbackDirectories = getAllKnownBaseDirectories();
  const sessions = await fetchAllOpenCodeSessions(
    openCodePort,
    fallbackDirectories,
  );
  if (!sessions) return; // API unreachable — skip silently

  // Intentionally avoid destructive pruning on manual refresh (force=true).
  // OpenCode endpoints can return partial session sets transiently; deleting
  // missing sessions here causes channel-list flicker across consecutive refreshes.
  // Session removals should come from authoritative session.deleted.1 events.
  void force;

  let seeded = 0;
  for (const session of sessions) {
    if (_tombstonedSessionIds.has(session.id)) continue;
    const info: SessionInfo = {
      id: session.id,
      parentID: session.parentID ?? null,
      title: (session as SessionInfo & { title?: string }).title,
      directory: (session as SessionInfo & { directory?: string }).directory,
      time: session.time,
    };
    _sessionCache.set(session.id, info);
    if (state.getAutoRegisterSubagents?.() ?? true) {
      autoRegisterSession(info, { scheduleSnapshot: false });
    }
    seeded++;
  }

  if (seeded > 0) {
    console.log(`[session-tree] seeded ${seeded} sessions from REST`);
    scheduleSnapshot();
  }

  state.restSeedCompleted = true;
}

export function getAllKnownBaseDirectories(): string[] {
  const directories = getAllRegisteredConnections()
    .map((entry) => entry.baseDirectory?.trim() ?? '')
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(directories));
}

/**
 * Re-seed the session cache from the OpenCode REST API and emit a fresh
 * snapshot. Called on demand when the user clicks the refresh button in the
 * sidebar. Uses the currently configured OpenCode port (or default 4096).
 */
export async function refreshSessionTreeCache(): Promise<void> {
  const port = state.getOpenCodePort?.() ?? 4096;
  await seedCacheFromRest(port, true);
}
