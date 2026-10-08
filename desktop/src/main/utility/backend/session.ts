/**
 * Shared utility for detecting and managing OpenCode sessions via SDK.
 *
 * Strategy:
 * 1. Query sessions with directory filter for directory-scoped sessions.
 * 2. If that returns nothing, fall back to all sessions.
 * 3. Sort by time.updated DESC (most recent activity first), matching
 *    OpenCode's v2 session-list ordering.
 * 4. Return { id, parentId } for the best match, or null on failure.
 */

import {
  sessionList,
  sessionGet,
  sessionChildren,
  sessionCreate,
  sessionPromptAsync,
  sessionUpdate,
} from './session-api';
import type { SessionCreateBody } from './session-api';
import { errorMessage } from '../../utils/errors';
import { toProviderReasoningVariant } from '../../../shared/reasoning-variant';

export interface DetectedSession {
  id: string;
  parentId: string | null;
  directory?: string;
}

export interface OpenCodeSession {
  id: string;
  parentID?: string | null;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number; archived?: number };
  version?: string;
  summary?: { additions?: number; deletions?: number; files?: number };
}

export interface SessionListOptions {
  roots?: boolean;
  limit?: number;
  archived?: boolean;
}

function sortByRecentActivity(a: OpenCodeSession, b: OpenCodeSession): number {
  return (
    (b.time?.updated ?? b.time?.created ?? 0) -
    (a.time?.updated ?? a.time?.created ?? 0)
  );
}

/**
 * Fetch sessions from OpenCode API using SDK.
 */
async function fetchSessions(
  openCodePort: number,
  directory?: string,
  options?: SessionListOptions,
): Promise<OpenCodeSession[] | null> {
  try {
    const response = await sessionList(
      openCodePort,
      {
        roots: options?.roots,
        limit: options?.limit,
        archived: options?.archived,
      },
      { directory, signal: AbortSignal.timeout(2000) },
    );

    if (response.error) return null;

    const data = response.data;
    if (!Array.isArray(data)) return null;

    return data as OpenCodeSession[];
  } catch {
    return null;
  }
}

export async function fetchOpenCodeSession(
  openCodePort: number,
  sessionID: string,
  directory?: string,
): Promise<OpenCodeSession | null> {
  try {
    const response = await sessionGet(openCodePort, sessionID, {
      directory,
      signal: AbortSignal.timeout(2000),
    });

    if (response.error) return null;

    const data = response.data;
    if (!data || typeof data !== 'object') return null;

    return data as OpenCodeSession;
  } catch {
    return null;
  }
}

export async function fetchOpenCodeSessionChildren(
  openCodePort: number,
  sessionID: string,
  directory?: string,
): Promise<OpenCodeSession[] | null> {
  try {
    const response = await sessionChildren(openCodePort, sessionID, {
      directory,
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
 * Fetch sessions scoped to a single base directory.
 *
 * Mirrors OpenCode's per-directory client pattern: the directory is passed
 * via the `x-opencode-directory` header so the server applies its
 * project-filter to the returned session list. Returns null if the API is
 * unreachable. Sorted by `time.updated` DESC (most recent activity first).
 *
 * Used by the session-tree seed, the tree-poller, and the reconcile-on-startup
 * path once the renderer has selected a project folder in the sidebar. Callers
 * must pass a non-empty, absolute directory; empty/whitespace paths fall back
 * to the unscoped listing (matches server behavior).
 */
export async function fetchSessionsForDirectory(
  openCodePort: number,
  baseDirectory: string,
): Promise<OpenCodeSession[] | null> {
  const trimmed = baseDirectory.trim();
  const directory = trimmed.length > 0 ? trimmed : undefined;
  const sessions = await fetchSessions(openCodePort, directory);
  if (!sessions) return null;
  return [...sessions].sort(sortByRecentActivity);
}

export async function fetchRootSessionsForDirectory(
  openCodePort: number,
  baseDirectory: string,
  limit: number,
  archived = false,
): Promise<OpenCodeSession[] | null> {
  const trimmed = baseDirectory.trim();
  if (trimmed.length === 0) return [];
  const sessions = await fetchSessions(openCodePort, trimmed, {
    roots: true,
    limit,
    archived,
  });
  if (!sessions) return null;
  return [...sessions].sort(sortByRecentActivity);
}

export async function archiveOpenCodeSession(
  openCodePort: number,
  sessionID: string,
  archived: boolean,
): Promise<boolean> {
  const archivedAt = archived ? Date.now() : undefined;
  return setSessionArchivedRecursive(openCodePort, sessionID, archivedAt);
}

async function setSessionArchivedRecursive(
  openCodePort: number,
  sessionID: string,
  archivedAt: number | undefined,
  directory?: string,
): Promise<boolean> {
  const children = await fetchOpenCodeSessionChildren(
    openCodePort,
    sessionID,
    directory,
  );
  if (children === null) return false;

  const childResults = await Promise.all(
    children.map((child) =>
      setSessionArchivedRecursive(
        openCodePort,
        child.id,
        archivedAt,
        child.directory ?? directory,
      ),
    ),
  );
  if (childResults.some((ok) => !ok)) return false;

  const response = await sessionUpdate(
    openCodePort,
    sessionID,
    { time: { archived: archivedAt } },
    directory ? { directory } : undefined,
  );
  return !response.error;
}

/**
 * Fetch every session known to the OpenCode API (no directory filter).
 * Returns null if the API is unreachable.
 */
export async function fetchAllOpenCodeSessions(
  openCodePort: number,
  fallbackDirectories: string[] = [],
  options: SessionListOptions = {},
): Promise<OpenCodeSession[] | null> {
  const unscoped = await fetchSessions(openCodePort, undefined, options);
  if (!unscoped) return null;

  const scopedDirectories = Array.from(
    new Set(
      fallbackDirectories
        .map((dir) => dir.trim())
        .filter((dir) => dir.length > 0),
    ),
  );

  if (scopedDirectories.length === 0) {
    return [...unscoped].sort(sortByRecentActivity);
  }

  const scopedResults = await Promise.all(
    scopedDirectories.map((dir) => fetchSessions(openCodePort, dir, options)),
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

  return Array.from(mergedById.values()).sort(sortByRecentActivity);
}

export async function fetchRootOpenCodeSessions(
  openCodePort: number,
  fallbackDirectories: string[] = [],
): Promise<OpenCodeSession[] | null> {
  const unscoped = await fetchSessions(openCodePort, undefined, {
    roots: true,
  });
  if (!unscoped) return null;

  const scopedDirectories = Array.from(
    new Set(
      fallbackDirectories
        .map((dir) => dir.trim())
        .filter((dir) => dir.length > 0),
    ),
  );

  if (scopedDirectories.length === 0) {
    return [...unscoped].sort(sortByRecentActivity);
  }

  const scopedResults = await Promise.all(
    scopedDirectories.map((dir) =>
      fetchSessions(openCodePort, dir, { roots: true }),
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

  return Array.from(mergedById.values()).sort(sortByRecentActivity);
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

export async function expandOpenCodeSessionTree(
  openCodePort: number,
  roots: OpenCodeSession[],
): Promise<OpenCodeSession[]> {
  const byId = new Map<string, OpenCodeSession>();
  const queue = [...roots];

  for (const root of roots) {
    byId.set(root.id, root);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const children = await fetchOpenCodeSessionChildren(
      openCodePort,
      current.id,
      current.directory,
    );
    if (!children || children.length === 0) continue;

    for (const child of children) {
      if (byId.has(child.id)) continue;
      byId.set(child.id, child);
      queue.push(child);
    }
  }

  return Array.from(byId.values()).sort(sortByRecentActivity);
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
 * 4. Within each tier (root vs child), sort by recent activity.
 * 5. Return { id, parentId } for the best match, or null on failure.
 */
export async function autoDetectOpenCodeSession(
  openCodePort: number,
  baseDirectory?: string,
): Promise<DetectedSession | null> {
  let sessions = baseDirectory
    ? await fetchSessions(openCodePort, baseDirectory)
    : null;

  // If directory-scoped query returned nothing, fall back to all sessions
  if (!sessions || sessions.length === 0) {
    sessions = await fetchSessions(openCodePort);
  }

  if (!sessions || sessions.length === 0) return null;

  // Prefer root sessions (no parentID) — the caller is most likely the main
  // agent. Only fall back to children if there are no root sessions.
  const roots = sessions.filter((s) => !s.parentID);
  const candidates = roots.length > 0 ? roots : sessions;

  // Within the chosen tier, pick the most recently active session.
  const sorted = [...candidates].sort(sortByRecentActivity);

  const best = sorted[0];
  return {
    id: best.id,
    parentId: best.parentID ?? null,
    directory: best.directory,
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
 * Body sent to OpenCode's `POST /session/{id}/prompt_async` when seeding a
 * freshly created session with its initial user message.
 *
 * The `agent` key is intentionally optional and omitted entirely when not
 * provided — OpenCode treats a missing key differently from an empty string.
 */
export interface InitialPromptBody {
  parts: { type: 'text'; text: string }[];
  agent?: string;
  model?: { providerID: string; modelID: string };
}

/**
 * Pure helper that builds the body for the initial `prompt_async` call.
 *
 * - When `agent` is undefined, empty, or whitespace-only, the `agent` key is
 *   omitted from the returned body (OpenCode treats missing ≠ empty string).
 * - Otherwise the agent name is trimmed and included.
 */
export function buildInitialPromptBody(input: {
  initialMessage: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}): InitialPromptBody {
  const body: InitialPromptBody = {
    parts: [{ type: 'text', text: input.initialMessage }],
  };

  const trimmedAgent = input.agent?.trim();
  if (trimmedAgent && trimmedAgent.length > 0) {
    body.agent = trimmedAgent;
  }
  if (input.model) {
    body.model = input.model;
  }

  return body;
}

/**
 * Create a new OpenCode session via SDK.
 *
 * Uses sessionCreate() with optional title, parentID, agent, and model.
 * When a directory is provided, the session is created in that directory context,
 * which loads the project's `.opencode/opencode.jsonc` config and project-specific MCPs.
 * After creating the session, optionally sends an initial message via promptAsync.
 * If an `agent` is provided alongside an `initialMessage`, it is also forwarded
 * to `promptAsync` so the first message uses the same explicit agent.
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
    /** Optional OpenCode agent name (e.g. "build", "plan", "docs-maintainer"). */
    agent?: string;
    /** Optional model selection for SDK session.create. */
    model?: SessionCreateBody['model'];
  } = {},
): Promise<CreateSessionResult> {
  try {
    // Match OpenCode app behavior: create a directory-scoped client first,
    // then call session.create() on that client.
    const trimmedAgent = options.agent?.trim();
    const createBody: SessionCreateBody = {
      title: options.title,
      parentID: options.parentID,
    };
    if (trimmedAgent) {
      createBody.agent = trimmedAgent;
    }
    const providerModel = options.model
      ? {
          providerID: options.model.providerID,
          id: options.model.id,
          variant: toProviderReasoningVariant(options.model.variant),
        }
      : undefined;
    if (providerModel) {
      createBody.model = providerModel;
    }

    const createResponse = await sessionCreate(openCodePort, createBody, {
      directory: options.directory,
      signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS),
    });

    if (createResponse.error) {
      const rawError: unknown = createResponse.error;
      const errorMessage =
        typeof rawError === 'string' ? rawError : 'OpenCode API returned error';
      return { ok: false, error: errorMessage };
    }

    const session = createResponse.data as OpenCodeSession;

    // If an initial message is provided, send it to the session
    // NOTE: Attachments are handled separately via injectOpenCodeMessage in the IPC handler
    // because it requires access to the attachment store and MCP server port
    if (options.initialMessage && session.id) {
      try {
        const messageResponse = await sessionPromptAsync(
          openCodePort,
          session.id,
          buildInitialPromptBody({
            initialMessage: options.initialMessage,
            agent: options.agent,
            model: options.model
              ? {
                  providerID: options.model.providerID,
                  modelID: options.model.id,
                }
              : undefined,
          }),
          {
            directory: options.directory,
            signal: AbortSignal.timeout(SESSION_MESSAGE_TIMEOUT_MS),
          },
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
    const msg = errorMessage(err);
    return { ok: false, error: msg };
  }
}
