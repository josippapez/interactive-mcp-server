/**
 * SSE (Server-Sent Events) subscription and event handling for the OpenCode
 * `/global/event` stream. Dispatches session lifecycle events into the cache
 * and forwards tool-call/message-part events to the renderer.
 */

import { fetchOpenCodeSession } from '../../opencode/session';
import {
  updateSessionTokens,
  type MessageTokens,
} from '../../opencode/context-tracking';
import { DEFAULT_OPENCODE_PORT } from '../../opencode/endpoints';
import { createLogger } from '../../utils/logger';
import { autoRegisterSession, tryAutoBindSession } from './auto-register';
import { mapPartType, mapToolStatus } from './part-mapping';
import { seedCacheFromRest } from './rest-seed';
import { emitOptimisticChildSession, scheduleSnapshot } from './snapshot';
import { _sessionCache, _tombstonedSessionIds, state } from './state';
import { resolveChildSessionIdFromTaskPart } from './task-subagent-detect';
import {
  SSE_RECONNECT_DELAY_MS,
  type SessionInfo,
  type SyncEventEnvelope,
} from './types';
import { errorMessage } from '../../utils/errors';

const log = createLogger('session-tree');

// ─── Task-subagent hydration ─────────────────────────────────────────────────

/**
 * Hydrate a Task-tool-spawned subagent session into the cache.
 *
 * OpenCode's `/global/event` stream does not emit `session.created.1`
 * for child sessions spawned by the Task tool. We detect them via the
 * `message.part.updated.1` event whose `part.state.metadata.sessionId`
 * carries the child ID, then fetch the full session info via REST and
 * merge it through the same cache path used by `session.created.1`.
 */
async function hydrateTaskSubagentSession(
  childSessionId: string,
  parentSessionId: string,
): Promise<void> {
  // Guard: another part update could race us.
  if (_sessionCache.has(childSessionId)) return;
  if (_tombstonedSessionIds.has(childSessionId)) return;

  const port = state.getOpenCodePort?.() ?? DEFAULT_OPENCODE_PORT;
  log.info(
    `hydrateTaskSubagentSession: fetching child ${childSessionId} (parent=${parentSessionId})`,
  );
  const session = await fetchOpenCodeSession(port, childSessionId);

  // Re-check cache after async fetch (SSE may have caught up).
  if (_sessionCache.has(childSessionId)) return;
  if (_tombstonedSessionIds.has(childSessionId)) return;

  const info: SessionInfo = session
    ? {
        id: childSessionId,
        parentID: (session as SessionInfo).parentID ?? parentSessionId,
        title: (session as SessionInfo & { title?: string }).title,
        directory: (session as SessionInfo & { directory?: string }).directory,
        time: (session as SessionInfo & { time?: SessionInfo['time'] }).time,
        version: (session as SessionInfo & { version?: string }).version,
        summary: (session as SessionInfo & { summary?: SessionInfo['summary'] })
          .summary,
      }
    : {
        id: childSessionId,
        parentID: parentSessionId,
        title: `Subagent ${childSessionId.slice(0, 8)}`,
      };

  _sessionCache.set(childSessionId, info);
  log.info(
    `hydrateTaskSubagentSession: added ${childSessionId} to cache (size=${_sessionCache.size})`,
  );

  // Phase 4: auto-register first so the row exists, then auto-bind the pending
  // transport (if any) onto the now-existing row via updateConnectionId.
  const autoRegisterEnabled = state.getAutoRegisterSubagents?.() ?? true;
  if (autoRegisterEnabled) {
    autoRegisterSession(info, { scheduleSnapshot: false });
  }

  tryAutoBindSession(info);

  emitOptimisticChildSession(info);
  scheduleSnapshot();
}

// Silence unused warning for OpenCodeSession import when only used for casts.

// ─── SSE event dispatch ──────────────────────────────────────────────────────

export function handleSyncEvent(envelope: SyncEventEnvelope): void {
  const { type, data } = envelope.payload;

  if (type === 'session.created.1') {
    const info = data['info'] as SessionInfo | undefined;
    const sessionId = data['sessionID'] as string | undefined;
    log.info(
      `session.created.1 received: sessionId=${sessionId}, parentID=${info?.parentID ?? 'null'}, title=${info?.title ?? 'untitled'}`,
    );
    if (!sessionId || !info) {
      log.warn(`session.created.1 missing sessionId or info — skipping`);
      return;
    }

    const merged: SessionInfo = { ...info, id: sessionId };
    if (_tombstonedSessionIds.has(sessionId)) {
      log.info(`session ${sessionId} is tombstoned — skipping`);
      return;
    }

    _sessionCache.set(sessionId, merged);
    log.info(
      `session ${sessionId} added to cache, cache size=${_sessionCache.size}`,
    );

    const autoRegisterEnabled = state.getAutoRegisterSubagents?.() ?? true;
    log.info(`autoRegisterSubagents enabled: ${autoRegisterEnabled}`);

    // Phase 4: auto-register first so the row exists with connection_id=NULL,
    // then auto-bind the pending transport (if any) onto it.
    if (autoRegisterEnabled) {
      autoRegisterSession(merged, { scheduleSnapshot: false });
    }

    tryAutoBindSession(merged);

    emitOptimisticChildSession(merged);
    scheduleSnapshot();
    return;
  }

  if (type === 'session.updated.1') {
    const sessionId = data['sessionID'] as string | undefined;
    const info = data['info'] as Partial<SessionInfo> | undefined;
    if (!sessionId) return;

    const existing = _sessionCache.get(sessionId);
    if (existing && info) {
      // Merge partial updates — OpenCode sends sparse patches.
      _sessionCache.set(sessionId, { ...existing, ...info, id: sessionId });
      scheduleSnapshot();
    }
    return;
  }

  if (type === 'session.deleted.1') {
    const sessionId = data['sessionID'] as string | undefined;
    if (!sessionId) return;
    _sessionCache.delete(sessionId);
    scheduleSnapshot();
    return;
  }

  // Context/token tracking from message updates.
  // The message.updated.1 SyncEvent carries the full message info including
  // token counts on assistant messages. We extract token data and forward
  // context-usage-updated IPC events to the renderer so the ContextUsageBar
  // component can display real-time usage.
  if (type === 'message.updated.1') {
    const sessionID = data['sessionID'] as string | undefined;
    const info = data['info'] as Record<string, unknown> | undefined;
    if (!sessionID || !info) return;

    // Only process assistant messages (they carry token data)
    if (info['role'] !== 'assistant') return;

    const tokens = info['tokens'] as MessageTokens | undefined;
    if (!tokens) return;

    // Calculate the actual token count from the tokens object
    // Skip if there's no meaningful token data (empty object or all zeros)
    const tokenCount =
      tokens.total ?? (tokens.input ?? 0) + (tokens.output ?? 0);
    if (tokenCount <= 0) return;

    const modelID = info['modelID'] as string | undefined;
    const providerID = info['providerID'] as string | undefined;

    // Use replace=true because each assistant message's tokens represent
    // the cumulative input context for that step — the last message's total
    // IS the current context usage (matching the OpenCode app's approach).
    const usage = updateSessionTokens(
      sessionID,
      tokens,
      modelID,
      providerID,
      true,
    );

    // Forward to renderer
    const win = state.getWindow?.();
    if (!win || win.isDestroyed()) return;

    win.webContents.send('context-usage-updated', {
      sessionId: sessionID,
      totalTokens: usage.totalTokens,
      contextLimit: usage.contextLimit,
      usableLimit: usage.usableLimit,
      usagePercent: usage.usagePercent,
      isNearOverflow: usage.isNearOverflow,
      isOverflow: usage.isOverflow,
    });
    return;
  }

  // Forward message part updates to renderer (for tool call streaming)
  if (type === 'message.part.updated.1') {
    const part = data['part'] as Record<string, unknown> | undefined;
    const sessionID = data['sessionID'] as string | undefined;
    if (!part || !sessionID) return;

    // ─── Task-tool subagent hydration ──────────────────────────────────────
    // When the OpenCode Task tool spawns a subagent, the child session is
    // created server-side but the `/global/event` stream does NOT emit
    // a `session.created.1` event for it. The only signal we receive is this
    // `message.part.updated.1` event whose `part.state.metadata` carries
    // the child's session ID (under one of several possible key names).
    // Hydrate the child into the cache so it appears in the sidebar without
    // requiring a manual refresh.
    //
    // Detection is widened via `resolveChildSessionIdFromTaskPart` to tolerate
    // tool-name casing variations (`task`, `Task`, `TASK`) and metadata key
    // variants (`sessionId`, `sessionID`, `childSessionID`).
    const childSessionId = resolveChildSessionIdFromTaskPart(part);
    if (
      childSessionId &&
      !_sessionCache.has(childSessionId) &&
      !_tombstonedSessionIds.has(childSessionId)
    ) {
      void hydrateTaskSubagentSession(childSessionId, sessionID);
    }

    const win = state.getWindow?.();
    if (!win || win.isDestroyed()) return;

    // Extract messageID from the part (OpenCode parts have messageID property)
    const messageID = part['messageID'] as string | undefined;

    win.webContents.send('conversation-part-event', {
      type: 'part.updated',
      sessionId: sessionID,
      messageId: messageID,
      part: {
        id: part['id'] as string,
        type: mapPartType(part['type'] as string),
        text: part['text'] as string | undefined,
        toolName: part['tool'] as string | undefined,
        toolCallId: part['callID'] as string | undefined,
        toolInput: (part['state'] as Record<string, unknown> | undefined)?.[
          'input'
        ] as Record<string, unknown> | undefined,
        toolOutput: (part['state'] as Record<string, unknown> | undefined)?.[
          'output'
        ] as string | undefined,
        toolStatus: mapToolStatus(
          (part['state'] as Record<string, unknown> | undefined)?.['status'] as
            | string
            | undefined,
        ),
        // Forward metadata from tool state (contains sessionId for Task tools)
        toolMetadata: (part['state'] as Record<string, unknown> | undefined)?.[
          'metadata'
        ] as Record<string, unknown> | undefined,
      },
    });
    return;
  }
}

// ─── SSE subscription ────────────────────────────────────────────────────────

export async function subscribeToSyncEvents(
  openCodePort: number,
): Promise<void> {
  const controller = new AbortController();
  state.sseAbortController = controller;

  // Seed cache from REST before streaming starts.
  await seedCacheFromRest(openCodePort);

  const url = `http://localhost:${openCodePort}/global/event`;
  const attemptStartedAt = Date.now();
  const sincePreviousConnectMs =
    state.sseLastConnectedAt !== null
      ? attemptStartedAt - state.sseLastConnectedAt
      : null;
  log.info(
    `subscribing to SSE at ${url} reconnectCount=${state.sseReconnectCount} sincePreviousConnectMs=${sincePreviousConnectMs ?? '(first)'} timestamp=${new Date(attemptStartedAt).toISOString()}`,
  );

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    });

    if (!res.ok || !res.body) {
      log.warn(
        `SSE connect failed on port ${openCodePort}: ${res.status} — will retry in ${SSE_RECONNECT_DELAY_MS}ms (reconnectCount=${state.sseReconnectCount})`,
      );
      scheduleReconnect();
      return;
    }

    state.sseLastConnectedAt = Date.now();
    log.info(
      `SSE connected to ${url} reconnectCount=${state.sseReconnectCount} timestamp=${new Date(state.sseLastConnectedAt).toISOString()}`,
    );

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        log.info(`SSE stream ended on port ${openCodePort}`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are terminated by a double newline.
      const frames = buffer.split(/\n\n/);
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;

        const raw = dataLine.slice('data:'.length).trim();
        if (!raw) continue;

        try {
          const envelope = JSON.parse(raw) as SyncEventEnvelope;
          if (envelope?.payload?.type) {
            const eventType = envelope.payload.type;
            if (eventType.startsWith('session.')) {
              log.debug(`SSE event received: ${eventType}`);
            }
            handleSyncEvent(envelope);
          }
        } catch {
          // malformed JSON — ignore
        }
      }
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') return;
    log.warn(`SSE error on port ${openCodePort}: ${errorMessage(err)}`);
  }

  scheduleReconnect();
}

export function scheduleReconnect(): void {
  if (state.reconnectTimer !== null || state.sseAbortController === null)
    return;
  state.sseReconnectCount += 1;
  log.info(
    `scheduling SSE reconnect #${state.sseReconnectCount} in ${SSE_RECONNECT_DELAY_MS}ms timestamp=${new Date().toISOString()}`,
  );
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    const port = state.getOpenCodePort?.() ?? 4096;
    void subscribeToSyncEvents(port);
  }, SSE_RECONNECT_DELAY_MS);
}
