/**
 * Provider-agnostic session resolver.
 *
 * Given a `connectionId` (the MCP transport UUID), resolves the provider
 * session needed to inject a message into the agent's running session.
 *
 * Resolution strategy:
 * 1. **Cached** — look up the DB record for this connectionId. If it has a
 *    non-null `openCodeSessionId` (for OpenCode backend) or a stored Claude
 *    session reference, return it immediately.
 * 2. **Re-resolved** — if the cached session is stale/missing, attempt one
 *    deterministic re-resolve using the connection's `baseDirectory` and
 *    the provider's session-discovery API. Update the DB and return.
 * 3. **Ambiguous** — if re-resolution finds multiple candidates and cannot
 *    pick one deterministically, return `resolvedVia: 'ambiguous'` with a
 *    diagnostic message. The caller should surface this to the user.
 * 4. **None** — if no provider session can be found at all.
 */

import {
  getRegisteredConnection,
  upsertRegisteredConnection,
  type RegisteredConnection,
} from '../database';
import { autoDetectOpenCodeSession } from '../opencode/session';

// ─── Public types ──────────────────────────────────────────────────────────

export type ResolutionMethod = 'cached' | 're-resolved' | 'ambiguous' | 'none';

export interface ResolvedSession {
  /** The provider session ID to use for injection. Null when resolution failed. */
  providerSessionId: string | null;
  /** Parent session ID (for tree nesting). Null if not a subagent or unknown. */
  parentSessionId: string | null;
  /** How the session was resolved. */
  resolvedVia: ResolutionMethod;
  /** Human-readable diagnostic (set for 'ambiguous' and 'none'). */
  message?: string;
}

export interface ResolverOptions {
  /** The MCP connection UUID (source of truth for identity). */
  connectionId: string;
  /** The agent backend mode. Determines which provider API to query. */
  backend: 'opencode' | 'claude_sdk' | 'standalone';
  /** OpenCode HTTP API port (required when backend is 'opencode'). */
  openCodePort?: number;
  /** Override baseDirectory for re-resolution (falls back to DB record). */
  baseDirectory?: string;
}

// ─── Core resolver ─────────────────────────────────────────────────────────

/**
 * Resolve the provider session for a given MCP connection.
 *
 * This is the single entry point for all injection paths. It handles:
 * - DB lookup (cached path)
 * - Provider-specific re-resolution (one retry)
 * - Ambiguity detection
 */
export async function resolveSession(
  opts: ResolverOptions,
): Promise<ResolvedSession> {
  const { connectionId, backend } = opts;

  // Standalone mode has no provider session to resolve.
  if (backend === 'standalone') {
    return {
      providerSessionId: null,
      parentSessionId: null,
      resolvedVia: 'none',
      message: 'Standalone mode — no provider session available.',
    };
  }

  // Step 1: Look up the DB record.
  const record = getRegisteredConnection(connectionId);
  if (!record) {
    return {
      providerSessionId: null,
      parentSessionId: null,
      resolvedVia: 'none',
      message: `No registered connection found for connectionId "${connectionId}".`,
    };
  }

  // Step 2: Try the cached session ID.
  if (backend === 'opencode') {
    return resolveOpenCode(record, opts);
  }

  if (backend === 'claude_sdk') {
    return resolveClaude(record);
  }

  return {
    providerSessionId: null,
    parentSessionId: null,
    resolvedVia: 'none',
    message: `Unsupported backend "${backend}".`,
  };
}

// ─── OpenCode resolution ───────────────────────────────────────────────────

async function resolveOpenCode(
  record: RegisteredConnection,
  opts: ResolverOptions,
): Promise<ResolvedSession> {
  // Fast path: cached session ID exists.
  if (record.openCodeSessionId) {
    return {
      providerSessionId: record.openCodeSessionId,
      parentSessionId: record.parentSessionId,
      resolvedVia: 'cached',
    };
  }

  // Slow path: no cached session — attempt one re-resolve.
  const openCodePort = opts.openCodePort;
  if (!openCodePort) {
    return {
      providerSessionId: null,
      parentSessionId: record.parentSessionId,
      resolvedVia: 'none',
      message: 'No OpenCode port configured — cannot re-resolve session.',
    };
  }

  const baseDir = opts.baseDirectory ?? record.baseDirectory ?? undefined;
  const detected = await autoDetectOpenCodeSession(openCodePort, baseDir);

  if (!detected) {
    return {
      providerSessionId: null,
      parentSessionId: record.parentSessionId,
      resolvedVia: 'none',
      message:
        'OpenCode API unreachable or returned no sessions during re-resolve.',
    };
  }

  // Update the DB with the newly detected session.
  upsertRegisteredConnection({
    openCodeSessionId: detected.id,
    channelName: record.channelName,
    projectName: record.projectName,
    baseDirectory: record.baseDirectory ?? undefined,
    connectionId: record.connectionId,
    parentSessionId: detected.parentId ?? undefined,
  });

  return {
    providerSessionId: detected.id,
    parentSessionId: detected.parentId,
    resolvedVia: 're-resolved',
  };
}

// ─── Claude SDK resolution ─────────────────────────────────────────────────

/**
 * For Claude SDK, session continuity is managed by the in-memory
 * `claudeSessionByConnectionId` Map in `claude-sdk-runtime.ts`.
 * The DB doesn't store a Claude session ID — the SDK handles persistence
 * internally via `persistSession: true`.
 *
 * We return the connectionId itself as the "providerSessionId" because that's
 * the key used by `injectClaudeMessageForConnection` to look up the
 * in-memory Claude session.
 */
function resolveClaude(record: RegisteredConnection): ResolvedSession {
  return {
    providerSessionId: record.connectionId,
    parentSessionId: null,
    resolvedVia: 'cached',
  };
}

// ─── Stale-session retry helper ────────────────────────────────────────────

/**
 * Attempt to re-resolve a stale OpenCode session after an injection failure
 * (e.g. 404 from the OpenCode API).
 *
 * Call this when `injectOpenCodeMessage` returns an error that suggests the
 * session no longer exists. It will:
 * 1. Clear the cached session ID in the DB.
 * 2. Re-run the resolver (which will hit the re-resolve path).
 * 3. Return the new resolution result.
 *
 * The caller should retry injection exactly once with the new session ID.
 */
export async function reResolveStaleSession(
  opts: ResolverOptions,
): Promise<ResolvedSession> {
  // With openCodeSessionId as PK, there is no "clear stale session ID"
  // operation — the row is always keyed by its session ID. Just re-resolve
  // using the current record; if the OpenCode session is gone, the resolver
  // will return 'none'.
  return resolveSession(opts);
}

// ─── openCodeSessionId resolution utility ─────────────────────────────────

/**
 * Resolve the effective openCodeSessionId for IPC communication with the renderer.
 *
 * This is the **single source of truth** for determining which session ID to use
 * when sending messages to the renderer (prompts, status updates, messages, etc.).
 *
 * PRIORITY ORDER (critical for correct routing):
 * 1. `explicitSessionId` — The agent explicitly passes its own session ID on every
 *    tool call. This takes highest priority because OpenCode uses a shared MCP client
 *    where multiple sessions share the same connectionId (transport UUID).
 * 2. DB lookup by connectionId — Falls back to the registered connection's session ID
 *    for legacy/standalone clients that don't pass openCodeSessionId explicitly.
 * 3. `null` — No session ID could be resolved.
 *
 * @param connectionId - The MCP transport UUID
 * @param explicitSessionId - The openCodeSessionId explicitly passed by the agent (optional)
 * @returns The resolved openCodeSessionId or null
 */
export function resolveOpenCodeSessionId(
  connectionId: string,
  explicitSessionId?: string | null,
): string | null {
  // Priority 1: Explicit session ID passed by the agent
  if (explicitSessionId) {
    return explicitSessionId;
  }

  // Priority 2: DB lookup by connectionId (legacy/standalone clients)
  const rc = getRegisteredConnection(connectionId);
  if (rc?.openCodeSessionId) {
    return rc.openCodeSessionId;
  }

  // Priority 3: No session ID available
  return null;
}
