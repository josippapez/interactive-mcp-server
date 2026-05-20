import { clearSessionAttachments } from './attachment-store';
import { emitToRenderer } from './utility/backend/renderer-emit';

export interface RemovePersistedSessionDeps {
  /**
   * Returns the local OpenCode HTTP server port, or `null` if OpenCode is not
   * currently running / port is unknown. When `null`, the OpenCode-side
   * `DELETE /session/{id}` call is skipped (a warning is logged) and local
   * cleanup proceeds unchanged.
   */
  getOpenCodePort: () => number | null;
  /**
   * Calls OpenCode's `DELETE /session/{providerSessionId}` endpoint so the
   * upstream session (and its descendants) are removed on the OpenCode side.
   * Implementations MUST treat HTTP 404 as success (already deleted) and
   * MUST NOT throw on transient/network errors; the orchestrator catches
   * errors anyway, but treating 404 as success keeps logs clean.
   */
  deleteOpenCodeSession: (
    providerSessionId: string,
    port: number,
    directory?: string,
  ) => Promise<void>;
  forceTerminateChat: (connectionId: string) => void;
  closeSessionByConnectionId: (connectionId: string) => Promise<boolean>;
  deleteSessionChannel: (sessionId: string) => void | Promise<void>;
  /**
   * Delete the registered connection record.
   * Parameter is the providerSessionId (PK after Phase 2 schema change).
   */
  deleteRegisteredConnection: (
    providerSessionId: string,
  ) => void | Promise<void>;
  markSessionDeleted: (providerSessionId: string) => void | Promise<void>;
  /**
   * Invalidate the session tree so the renderer pulls a fresh snapshot on its
   * own schedule. Replaces the old `triggerSessionTreeUpdate` direct-push to
   * avoid IPC storms.
   */
  invalidate: () => void | Promise<void>;
  /**
   * Look up the registered connection record for a given connectionId.
   * Used to resolve the provider session ID before the record is deleted,
   * so that we can tombstone it and prevent the session-tree poller from
   * re-adding the just-deleted node.
   */
  getRegisteredConnection: (connectionId: string) =>
    | {
        providerSessionId: string;
        providerType?: 'opencode' | 'copilot-cli' | 'claude-sdk' | 'standalone';
      }
    | null
    | undefined
    | Promise<
        | {
            providerSessionId: string;
            providerType?:
              | 'opencode'
              | 'copilot-cli'
              | 'claude-sdk'
              | 'standalone';
          }
        | null
        | undefined
      >;
  /**
   * Mark a provider session ID as tombstoned so the session-tree poller
   * excludes it from all subsequent snapshots.
   */
  tombstoneOpenCodeSession: (providerSessionId: string) => void | Promise<void>;
}

/**
 * Orchestrates the full cleanup for a single persisted session:
 * 1. Forcefully unblocks any pending prompt.
 * 2. Awaits the MCP transport close (graceful shutdown).
 * 3. Runs DB cleanup unconditionally, even if the transport close fails.
 * 4. Sends IPC events to the renderer.
 *
 * Returns `true` when the transport closed cleanly, `false` otherwise.
 * DB cleanup and IPC events always run regardless of the transport result.
 */
export async function removePersistedSession(
  sessionId: string,
  deps: RemovePersistedSessionDeps,
): Promise<boolean> {
  // Look up the provider session ID BEFORE deleting the registered-connection
  // row so we can tombstone it.  Once deleteRegisteredConnection runs, the row
  // is gone and we can no longer resolve the mapping.
  //
  // Priority:
  //   1. rc.providerSessionId — for sessions that have a registered MCP channel.
  //      The sessionId here is the connectionId; the provider session ID is
  //      stored in the registered_connections row.
  //   2. sessionId itself — for sessions that were never registered (or whose
  //      channel has already been cleaned up).  In that path the caller passes
  //      the providerSessionId directly as the sessionId.
  const rc = await deps.getRegisteredConnection(sessionId);
  const providerSessionId: string = rc?.providerSessionId ?? sessionId;

  deps.forceTerminateChat(sessionId);

  let closeOk: boolean;
  try {
    closeOk = await deps.closeSessionByConnectionId(sessionId);
  } catch (err) {
    console.error(
      '[removePersistedSession] closeSessionByConnectionId failed:',
      err,
    );
    closeOk = false;
  }

  // Always clean up DB state — even if the transport close failed.
  await deps.deleteSessionChannel(sessionId);
  if (providerSessionId !== sessionId) {
    await deps.deleteSessionChannel(providerSessionId);
  }
  await deps.deleteRegisteredConnection(providerSessionId);
  await deps.markSessionDeleted(providerSessionId);

  // Delete the upstream OpenCode session via DELETE /session/{id}.
  //
  // Without this call, the OpenCode server still considers the session alive,
  // and on next app restart `fetchSessionTree()` re-pulls it and the row
  // reappears in the sidebar (often flagged "running"). Local-only deletion
  // is not enough.
  //
  // Gating:
  //   - When a registered-connection record exists, only delete OpenCode-typed
  //     sessions. Non-OpenCode providers (claude-sdk, copilot-cli, standalone)
  //     have nothing to delete on the OpenCode side.
  //   - When NO registered-connection record exists (orphaned local row),
  //     fall back to the OpenCode session-id format `ses_*`. This is defensive
  //     for sessions whose registered-connection row was lost or never created.
  //
  // Idempotency: the implementation in `session-channel-handlers.ts` treats
  // HTTP 404 as success, and any thrown error is caught here so local cleanup
  // (tombstone, IPC events) always runs.
  const isOpenCode = rc
    ? rc.providerType === 'opencode' || rc.providerType === undefined
    : /^ses_/.test(sessionId);
  if (isOpenCode) {
    const port = deps.getOpenCodePort();
    if (port == null || port <= 0) {
      console.warn(
        '[removePersistedSession] OpenCode port unavailable; skipping DELETE /session call for',
        providerSessionId,
      );
    } else {
      try {
        await deps.deleteOpenCodeSession(providerSessionId, port);
      } catch (err) {
        console.warn(
          '[removePersistedSession] deleteOpenCodeSession failed (continuing local cleanup):',
          err,
        );
      }
    }
  }

  // Remove any ephemeral attachment files for this session. Both the
  // providerSessionId (OpenCode) and the connectionId (non-OpenCode) may have
  // been used as the attachment sessionKey, so clear both directories.
  clearSessionAttachments(providerSessionId);
  if (sessionId !== providerSessionId) {
    clearSessionAttachments(sessionId);
  }

  // Tombstone the provider session so the session-tree poller never re-adds
  // the just-deleted node while the OpenCode session itself still lives.
  // Also tombstones all descendant sessions (children of children, etc.) so
  // the entire subtree disappears from the sidebar.
  await deps.tombstoneOpenCodeSession(providerSessionId);

  void deps.invalidate();

  // Always notify the renderer so the UI clears the session.
  emitToRenderer('connection-closed', {
    connectionId: sessionId,
  });
  emitToRenderer('session-channel-deleted', { sessionId });
  if (providerSessionId !== sessionId) {
    emitToRenderer('session-channel-deleted', { sessionId: providerSessionId });
  }

  return closeOk;
}
