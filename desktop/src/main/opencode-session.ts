/**
 * Shared utility for detecting the active OpenCode session via its HTTP API.
 *
 * Strategy:
 * 1. Query /session?directory=<dir> for directory-scoped sessions.
 * 2. If that returns nothing, fall back to /session (all sessions).
 * 3. Sort by time.created DESC (newest first) so that freshly-spawned
 *    subagent sessions are preferred over the longer-running parent session.
 * 4. Return { id, parentId } for the best match, or null on failure.
 */

export interface DetectedSession {
  id: string;
  parentId: string | null;
}

export interface OpenCodeSession {
  id: string;
  parentID?: string | null;
  time?: { created?: number; updated?: number };
}

async function fetchSessions(url: string): Promise<OpenCodeSession[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as OpenCodeSession[]) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch every session known to the OpenCode API (no directory filter).
 * Returns null if the API is unreachable.
 */
export async function fetchAllOpenCodeSessions(
  openCodePort: number,
): Promise<OpenCodeSession[] | null> {
  return fetchSessions(`http://localhost:${openCodePort}/session`);
}

/**
 * Walk the session tree and return all sessions that are descendants of
 * `rootSessionId` (i.e. sessions whose parentID chain leads back to it).
 */
export function collectDescendants(
  rootSessionId: string,
  allSessions: OpenCodeSession[],
): OpenCodeSession[] {
  const descendants: OpenCodeSession[] = [];
  const queue = [rootSessionId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const s of allSessions) {
      if (s.parentID === current) {
        descendants.push(s);
        queue.push(s.id);
      }
    }
  }
  return descendants;
}

/**
 * Detect the best OpenCode session for the given directory.
 * Returns the most-recently-CREATED matching session with its parentID.
 *
 * Strategy:
 * 1. Query /session?directory=<dir> for directory-scoped sessions.
 * 2. If that returns nothing, fall back to /session (all sessions).
 * 3. Sort by time.created DESC (newest first) so that freshly-spawned
 *    subagent sessions are preferred over the longer-running parent session.
 * 4. Return { id, parentId } for the best match, or null on failure.
 */
export async function autoDetectOpenCodeSession(
  openCodePort: number,
  baseDirectory?: string,
): Promise<DetectedSession | null> {
  const dir = baseDirectory ?? process.cwd();
  const scopedUrl = `http://localhost:${openCodePort}/session?directory=${encodeURIComponent(dir)}`;

  let sessions = await fetchSessions(scopedUrl);

  // If directory-scoped query returned nothing, fall back to all sessions
  if (!sessions || sessions.length === 0) {
    sessions = await fetchSessions(`http://localhost:${openCodePort}/session`);
  }

  if (!sessions || sessions.length === 0) return null;

  // Sort by most recently CREATED (newest first).
  // This ensures a freshly-spawned subagent session is preferred over the
  // parent session that has been running (and updating) for longer.
  const sorted = [...sessions].sort(
    (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0),
  );

  const best = sorted[0];
  return {
    id: best.id,
    parentId: best.parentID ?? null,
  };
}

/**
 * Convenience wrapper that returns only the session ID string (for callers
 * that don't need the parentID).
 */
export async function autoDetectOpenCodeSessionId(
  openCodePort: number,
  baseDirectory?: string,
): Promise<string | null> {
  const result = await autoDetectOpenCodeSession(openCodePort, baseDirectory);
  return result?.id ?? null;
}
