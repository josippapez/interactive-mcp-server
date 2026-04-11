import type { BrowserWindow } from 'electron';

export interface RemovePersistedSessionDeps {
  getWindow: () => BrowserWindow | null;
  getOpenCodePort: () => number;
  forceTerminateChat: (connectionId: string) => void;
  closeSessionByConnectionId: (connectionId: string) => Promise<boolean>;
  deleteSessionChannel: (sessionId: string) => void;
  /**
   * Delete the registered connection record.
   * Parameter is the openCodeSessionId (PK after Phase 2 schema change).
   */
  deleteRegisteredConnection: (openCodeSessionId: string) => void;
  markConnectionDeleted: (connectionId: string) => void;
  triggerSessionTreeUpdate: (
    getWindow: () => BrowserWindow | null,
    getOpenCodePort: () => number,
  ) => void | Promise<void>;
  /**
   * Look up the registered connection record for a given connectionId.
   * Used to resolve the OpenCode session ID before the record is deleted,
   * so that we can tombstone it and prevent the session-tree poller from
   * re-adding the just-deleted node.
   */
  getRegisteredConnection: (
    connectionId: string,
  ) => { openCodeSessionId: string } | null | undefined;
  /**
   * Mark an OpenCode session ID as tombstoned so the session-tree poller
   * excludes it from all subsequent snapshots.
   */
  tombstoneOpenCodeSession: (openCodeSessionId: string) => void;
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
  // Look up the OpenCode session ID BEFORE deleting the registered-connection
  // row so we can tombstone it.  Once deleteRegisteredConnection runs, the row
  // is gone and we can no longer resolve the mapping.
  //
  // Priority:
  //   1. rc.openCodeSessionId — for sessions that have a registered MCP channel.
  //      The sessionId here is the connectionId; the OpenCode session ID is
  //      stored in the registered_connections row.
  //   2. sessionId itself — for sessions that were never registered (or whose
  //      channel has already been cleaned up).  In that path the caller passes
  //      the openCodeSessionId directly as the sessionId.
  const rc = deps.getRegisteredConnection(sessionId);
  const openCodeSessionId: string = rc?.openCodeSessionId ?? sessionId;

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
  deps.deleteSessionChannel(sessionId);
  deps.deleteRegisteredConnection(openCodeSessionId);
  deps.markConnectionDeleted(sessionId);

  // Tombstone the OpenCode session so the session-tree poller never re-adds
  // the just-deleted node while the OpenCode session itself still lives.
  // Also tombstones all descendant sessions (children of children, etc.) so
  // the entire subtree disappears from the sidebar.
  deps.tombstoneOpenCodeSession(openCodeSessionId);

  void deps.triggerSessionTreeUpdate(deps.getWindow, deps.getOpenCodePort);

  // Always notify the renderer so the UI clears the session.
  deps.getWindow()?.webContents.send('connection-closed', {
    connectionId: sessionId,
  });
  deps.getWindow()?.webContents.send('session-channel-deleted', { sessionId });

  return closeOk;
}
