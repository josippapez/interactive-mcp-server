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

import {
  buildOpenCodePortCandidates,
  fetchJsonFromAllReachable,
} from './endpoints';

export interface DetectedSession {
  id: string;
  parentId: string | null;
}

export interface OpenCodeSession {
  id: string;
  parentID?: string | null;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
}

async function fetchSessions(
  openCodePort: number,
  path: string,
): Promise<OpenCodeSession[] | null> {
  try {
    const ports = buildOpenCodePortCandidates(openCodePort);
    const responses = await fetchJsonFromAllReachable<unknown>(
      ports,
      path,
      2000,
    );
    if (responses.length === 0) return null;

    const mergedById = new Map<string, OpenCodeSession>();
    for (const { data } of responses) {
      if (!Array.isArray(data)) continue;
      for (const session of data as OpenCodeSession[]) {
        mergedById.set(session.id, session);
      }
    }

    return Array.from(mergedById.values());
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
  fallbackDirectories: string[] = [],
): Promise<OpenCodeSession[] | null> {
  const unscoped = await fetchSessions(openCodePort, '/session');
  if (!unscoped) return null;

  const scopedDirectories = Array.from(
    new Set(
      fallbackDirectories
        .map((dir) => dir.trim())
        .filter((dir) => dir.length > 0),
    ),
  );

  if (scopedDirectories.length === 0) {
    return [...unscoped].sort(
      (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0),
    );
  }

  const scopedResults = await Promise.all(
    scopedDirectories.map((dir) =>
      fetchSessions(
        openCodePort,
        `/session?directory=${encodeURIComponent(dir)}`,
      ),
    ),
  );

  const mergedById = new Map<string, OpenCodeSession>();
  for (const session of unscoped) {
    mergedById.set(session.id, session);
  }
  for (const scoped of scopedResults) {
    if (!scoped) continue;
    for (const session of scoped) {
      mergedById.set(session.id, session);
    }
  }

  return Array.from(mergedById.values()).sort(
    (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0),
  );
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
 *
 * Strategy:
 * 1. Query /session?directory=<dir> for directory-scoped sessions.
 * 2. If that returns nothing, fall back to /session (all sessions).
 * 3. Prefer root sessions (no parentID) over subagent sessions — the caller
 *    is most likely the main agent, and we want to attach to its own session
 *    rather than a freshly-spawned child session.
 * 4. Within each tier (root vs child), sort by time.created DESC (newest first).
 * 5. Return { id, parentId } for the best match, or null on failure.
 */
export async function autoDetectOpenCodeSession(
  openCodePort: number,
  baseDirectory?: string,
): Promise<DetectedSession | null> {
  const dir = baseDirectory ?? process.cwd();
  let sessions = await fetchSessions(
    openCodePort,
    `/session?directory=${encodeURIComponent(dir)}`,
  );

  // If directory-scoped query returned nothing, fall back to all sessions
  if (!sessions || sessions.length === 0) {
    sessions = await fetchSessions(openCodePort, '/session');
  }

  if (!sessions || sessions.length === 0) return null;

  // Prefer root sessions (no parentID) — the caller is most likely the main
  // agent. Only fall back to children if there are no root sessions.
  const roots = sessions.filter((s) => !s.parentID);
  const candidates = roots.length > 0 ? roots : sessions;

  // Within the chosen tier, pick the most recently created session.
  const sorted = [...candidates].sort(
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

/**
 * Result of creating a new OpenCode session.
 */
export interface CreateSessionResult {
  ok: boolean;
  session?: OpenCodeSession;
  error?: string;
}

export interface SessionAttachment {
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

const CREATE_SESSION_TIMEOUT_MS = 10_000;
const SESSION_MESSAGE_TIMEOUT_MS = 120_000;

/**
 * Create a new OpenCode session via the HTTP API.
 *
 * Uses POST /session with optional title and parentID.
 * When a directory is provided, the session is created in that directory context,
 * which loads the project's `.opencode/opencode.jsonc` config and project-specific MCPs.
 * After creating the session, optionally sends an initial message.
 * If attachments are provided, they will be included in the initial message.
 */
export async function createOpenCodeSession(
  openCodePort: number,
  options: {
    title?: string;
    parentID?: string;
    initialMessage?: string;
    attachments?: SessionAttachment[];
    /** Directory context for the session - loads project-specific config from .opencode/ */
    directory?: string;
  } = {},
): Promise<CreateSessionResult> {
  // Build URL with optional directory query parameter
  const baseUrl = `http://localhost:${openCodePort}/session`;
  const url = options.directory
    ? `${baseUrl}?directory=${encodeURIComponent(options.directory)}`
    : baseUrl;

  try {
    // Create the session
    const createRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: options.title,
        parentID: options.parentID,
      }),
      signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS),
    });

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '');
      return {
        ok: false,
        error: `OpenCode API returned ${createRes.status}: ${body}`,
      };
    }

    const session = (await createRes.json()) as OpenCodeSession;

    // If an initial message is provided, send it to the session
    // NOTE: Attachments are handled separately via injectOpenCodeMessage in the IPC handler
    // because it requires access to the attachment store and MCP server port
    if (options.initialMessage && session.id) {
      const messageUrl = `http://localhost:${openCodePort}/session/${encodeURIComponent(session.id)}/message`;
      const messageRes = await fetch(messageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: options.initialMessage }],
        }),
        // Keep aligned with injector timeout for /session/:id/message.
        signal: AbortSignal.timeout(SESSION_MESSAGE_TIMEOUT_MS),
      });

      if (!messageRes.ok) {
        // Session was created but message failed - still return success
        // The session exists and can be used
        console.warn(
          `[createOpenCodeSession] Session created but initial message failed: ${messageRes.status}`,
        );
      }
    }

    return { ok: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
