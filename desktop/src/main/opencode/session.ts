/**
 * Shared utility for detecting and managing OpenCode sessions via SDK.
 *
 * Strategy:
 * 1. Query sessions with directory filter for directory-scoped sessions.
 * 2. If that returns nothing, fall back to all sessions.
 * 3. Sort by time.created DESC (newest first) so that freshly-spawned
 *    subagent sessions are preferred over the longer-running parent session.
 * 4. Return { id, parentId } for the best match, or null on failure.
 */

import { getClient } from './sdk-client';

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

/**
 * Fetch sessions from OpenCode API using SDK.
 */
async function fetchSessions(
  openCodePort: number,
  directory?: string,
): Promise<OpenCodeSession[] | null> {
  try {
    const client = getClient(openCodePort, directory);
    const response = await client.session.list({
      signal: AbortSignal.timeout(2000),
    });

    if (response.error) return null;

    const data = response.data;
    if (!Array.isArray(data)) return null;

    return data as OpenCodeSession[];
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
  const unscoped = await fetchSessions(openCodePort);
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
    scopedDirectories.map((dir) => fetchSessions(openCodePort, dir)),
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
 * 1. Query sessions with directory filter for directory-scoped sessions.
 * 2. If that returns nothing, fall back to all sessions.
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
  let sessions = await fetchSessions(openCodePort, dir);

  // If directory-scoped query returned nothing, fall back to all sessions
  if (!sessions || sessions.length === 0) {
    sessions = await fetchSessions(openCodePort);
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
 * Create a new OpenCode session via SDK.
 *
 * Uses client.session.create() with optional title and parentID.
 * When a directory is provided, the session is created in that directory context,
 * which loads the project's `.opencode/opencode.jsonc` config and project-specific MCPs.
 * After creating the session, optionally sends an initial message via promptAsync.
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
  try {
    const client = getClient(openCodePort, options.directory);

    // Match OpenCode app behavior: create a directory-scoped client first,
    // then call session.create() on that client.
    const createResponse = await client.session.create({
      body: {
        title: options.title,
        parentID: options.parentID,
      },
      signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS),
    });

    if (createResponse.error) {
      const errorMessage =
        typeof createResponse.error === 'string'
          ? createResponse.error
          : 'OpenCode API returned error';
      return { ok: false, error: errorMessage };
    }

    const session = createResponse.data as OpenCodeSession;

    // If an initial message is provided, send it to the session
    // NOTE: Attachments are handled separately via injectOpenCodeMessage in the IPC handler
    // because it requires access to the attachment store and MCP server port
    if (options.initialMessage && session.id) {
      try {
        const messageResponse = await client.session.promptAsync(
          {
            path: { id: session.id },
            body: {
              parts: [{ type: 'text', text: options.initialMessage }],
            },
          },
          { signal: AbortSignal.timeout(SESSION_MESSAGE_TIMEOUT_MS) },
        );

        if (messageResponse.error) {
          // Session was created but message failed - still return success
          // The session exists and can be used
          console.warn(
            `[createOpenCodeSession] Session created but initial message failed`,
          );
        }
      } catch {
        // Session was created but message failed - still return success
        console.warn(
          `[createOpenCodeSession] Session created but initial message failed`,
        );
      }
    }

    return { ok: true, session };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
