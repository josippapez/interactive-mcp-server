import type { HandlerContext, SessionStatusType } from './types';
import { findKeyByConnectionId } from './helpers';
import type { ConversationEvent } from '../../../../preload/api/types';
import { clearTerminalSessionState } from './status-state';
import type { SessionNode } from '../../types';

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

function toSideChannelStatus(
  evt: ConversationEvent,
): { sessionId: string; status: string; type: SessionStatusType } | null {
  switch (evt.type) {
    case 'session.next.retried':
      return {
        sessionId: evt.sessionId,
        status: `Retry ${evt.attempt}: ${evt.error.message}`,
        type: 'working',
      };
    case 'session.next.compaction.started':
      return {
        sessionId: evt.sessionId,
        status: `Compacting context (${evt.reason})`,
        type: 'working',
      };
    case 'session.next.compaction.ended':
      return {
        sessionId: evt.sessionId,
        status: 'Context compaction completed',
        type: 'success',
      };
    default:
      return null;
  }
}

function applySideChannelStatus(
  prev: Map<string, SessionNode>,
  event: ConversationEvent,
  sideChannelStatus: {
    sessionId: string;
    status: string;
    type: SessionStatusType;
  },
  timestamp: Date,
): Map<string, SessionNode> {
  const nodeId = sideChannelStatus.sessionId;
  if (!prev.has(nodeId)) return prev;
  const node = prev.get(nodeId)!;
  const next = new Map(prev);
  next.set(nodeId, {
    ...node,
    sessionStatuses: [
      ...node.sessionStatuses.filter(
        (status) =>
          !(
            event.type === 'session.next.compaction.ended' &&
            status.type === 'working' &&
            status.status.startsWith('Compacting context')
          ),
      ),
      {
        status: sideChannelStatus.status,
        type: sideChannelStatus.type,
        timestamp,
      },
    ],
  });
  return next;
}

function applyConversationStatus(
  prev: Map<string, SessionNode>,
  event: Extract<ConversationEvent, { type: 'session.status' }>,
  timestamp: Date,
): Map<string, SessionNode> {
  const nodeId = event.sessionId;
  if (event.status === 'streaming') {
    if (!prev.has(nodeId)) return prev;
    const node = prev.get(nodeId)!;
    if (node.sessionStatuses.some((status) => status.type === 'working')) {
      return prev;
    }
    const next = new Map(prev);
    next.set(nodeId, {
      ...node,
      sessionStatuses: [
        ...node.sessionStatuses,
        {
          status: 'Session active',
          type: 'working',
          timestamp,
        },
      ],
    });
    return next;
  }

  if (event.status === 'idle' || event.status === 'error') {
    return clearTerminalSessionState(prev, nodeId);
  }

  return prev;
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
        const clearedPrev =
          data.status === 'Session aborted'
            ? clearTerminalSessionState(prev, nodeId)
            : prev;
        const node = clearedPrev.get(nodeId)!;
        const next = new Map(prev);
        const previousStatuses =
          incomingType === 'working'
            ? node.sessionStatuses
            : node.sessionStatuses.filter(
                (status) => status.type !== 'working',
              );
        next.set(nodeId, {
          ...node,
          sessionStatuses: [
            ...previousStatuses,
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
  // - `idle` / `error` → clear 'working' statuses to hide the active indicator
  // ------------------------------------------------------------------
  disposers.push(
    window.api.onConversationBatch?.((batch) => {
      const statusEvents = batch.events.filter((evt) => {
        if (evt.type === 'session.status') return true;
        return toSideChannelStatus(evt) !== null;
      });
      if (statusEvents.length === 0) return;
      setNodes((prev) => {
        let next = prev;
        for (const evt of statusEvents) {
          const timestamp = new Date();
          if (evt.type === 'session.status') {
            next = applyConversationStatus(next, evt, timestamp);
            continue;
          }
          const sideChannelStatus = toSideChannelStatus(evt);
          if (sideChannelStatus) {
            next = applySideChannelStatus(
              next,
              evt,
              sideChannelStatus,
              timestamp,
            );
          }
        }
        return next;
      });
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
