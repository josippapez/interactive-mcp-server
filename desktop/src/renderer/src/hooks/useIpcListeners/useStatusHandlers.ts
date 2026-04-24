import type { HandlerContext, SessionStatusType } from './types';
import { findKeyByConnectionId } from './helpers';

/**
 * Window (in ms) after the renderer mounts during which auto-emitted
 * registration bookkeeping statuses (`success` / `info`) are suppressed.
 *
 * On every app open, the main process re-runs `register_connection` for
 * every reconnecting MCP client and emits a sequence of status events
 * (e.g. "Startup context injected", "Injected N project MCP(s)") via
 * `session-status-update`. Those events are timestamped NOW but reflect
 * reconnection housekeeping — not real work the user initiated.
 *
 * The previous behaviour pushed them onto `sessionStatuses`, leaving the
 * sidebar `StatusDot` perpetually green after every restart even though
 * no session was actually running.
 *
 * Layer A: drop terminal/idle statuses (`success`, `info`) emitted during
 * this grace window. We keep `working` (so a legitimately busy session
 * still shows red) and `error` (so the user still sees real failures).
 */
export const STARTUP_STATUS_GRACE_MS = 8000;

/**
 * Returns true when an incoming startup-time status event should be
 * dropped instead of appended to the node's `sessionStatuses` array.
 *
 * Exported for unit testing.
 */
export function shouldSuppressStartupStatus(
  type: SessionStatusType,
  nowMs: number,
  startMs: number,
  graceMs: number = STARTUP_STATUS_GRACE_MS,
): boolean {
  if (nowMs - startMs >= graceMs) return false;
  return type === 'success' || type === 'info';
}

/**
 * Registers IPC listeners for status and agent message events.
 * Handles: onSessionStatusUpdate, onConversationBatch (session.status), onAgentMessage
 *
 * Returns a disposer that removes every listener registered here.
 */
export function useStatusHandlers({
  setNodes,
  appendMessage,
}: HandlerContext): () => void {
  const disposers: Array<(() => void) | undefined> = [];

  // Anchor for the startup grace window — see `shouldSuppressStartupStatus`.
  const mountedAtMs = Date.now();

  // ------------------------------------------------------------------
  // Status updates and agent messages — keyed by connectionId
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onSessionStatusUpdate?.((data) => {
      const incomingType = data.type as SessionStatusType;
      if (shouldSuppressStartupStatus(incomingType, Date.now(), mountedAtMs)) {
        // Drop the event entirely — the sidebar dot would otherwise show
        // a stale "running/done" colour from registration bookkeeping.
        return;
      }
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (!nodeId) return prev;
        const node = prev.get(nodeId)!;
        const next = new Map(prev);
        next.set(nodeId, {
          ...node,
          sessionStatuses: [
            ...node.sessionStatuses,
            {
              status: data.status,
              type: incomingType,
              timestamp: new Date(),
            },
          ],
        });
        return next;
      });
    }),
  );

  // ------------------------------------------------------------------
  // Conversation batch — handle session status changes
  //
  // Migrated from the retired `onOpenCodeSessionStatus` IPC channel (C6).
  // We now subscribe to the single `onConversationBatch` stream and scan
  // for `session.status` events. The `sessionId` on the event is the
  // OpenCode provider session id, which is used directly as the node key.
  //
  // - `streaming` → add a 'working' status to show the active indicator
  // - `idle` → clear 'working' statuses to hide the active indicator
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onConversationBatch?.((batch) => {
      for (const evt of batch.events) {
        if (evt.type !== 'session.status') continue;
        const nodeId = evt.sessionId;

        if (evt.status === 'streaming') {
          // Add 'working' status when session starts streaming
          setNodes((prev) => {
            if (!prev.has(nodeId)) return prev;
            const node = prev.get(nodeId)!;
            // Check if already has a working status to avoid duplicates
            if (node.sessionStatuses.some((s) => s.type === 'working')) {
              return prev;
            }
            const next = new Map(prev);
            next.set(nodeId, {
              ...node,
              sessionStatuses: [
                ...node.sessionStatuses,
                {
                  status: 'Session active',
                  type: 'working' as SessionStatusType,
                  timestamp: new Date(),
                },
              ],
            });
            return next;
          });
        } else if (evt.status === 'idle') {
          // Clear 'working' statuses when session goes idle
          setNodes((prev) => {
            if (!prev.has(nodeId)) return prev;
            const node = prev.get(nodeId)!;
            const filteredStatuses = node.sessionStatuses.filter(
              (s) => s.type !== 'working',
            );
            if (filteredStatuses.length === node.sessionStatuses.length) {
              return prev;
            }
            const next = new Map(prev);
            next.set(nodeId, {
              ...node,
              sessionStatuses: filteredStatuses,
            });
            return next;
          });
        }
      }
    }),
  );

  disposers.push(
    window.api.onAgentMessage?.((data) => {
      // Use setNodes to find the map key, then use appendMessage for the actual update.
      setNodes((prev) => {
        const nodeId = findKeyByConnectionId(
          prev,
          data.connectionId,
          data.providerSessionId,
        );
        if (nodeId) {
          // Schedule the message append outside this updater.
          setTimeout(() => {
            appendMessage(nodeId, {
              kind: 'agent_message',
              text: data.message,
              timestamp: new Date(),
            });
          }, 0);
        }
        return prev;
      });
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose?.();
    }
  };
}
