/**
 * event-stream.ts — Conversation event stream
 *
 * ──────────────────────────────────────────────────────────────────────────
 * This is the **main-side pump** for the new streaming pipeline. It runs a
 * fetch-based SSE loop against the OpenCode server's `/global/event` endpoint (via
 * the SDK's `client.global.event()` async-iterator), maps each raw payload
 * through `event-bridge` to our `ConversationEvent` union, coalesces events
 * in-flight, and flushes coalesced batches to the renderer via
 * `webContents.send('conversation-batch', batch)` every ~16ms.
 *
 * Mirrors opencode web's `packages/app/src/context/global-sdk.tsx`:
 *
 *   - **Reconnect ladder**: outer `while (running)` loop with a 250ms
 *     delay between attempts. The SDK handles inner exponential backoff
 *     automatically (`sseDefaultRetryDelay`).
 *   - **Heartbeat watchdog**: 15s no-event timeout aborts the attempt
 *     and triggers reconnect. Prevents wedged half-open connections.
 *   - **In-flight coalescing**: `Map<semKey, qIdx>` so the latest
 *     whole-part / whole-message / whole-status event *replaces* any
 *     earlier one queued for the same semantic key (no stale
 *     whole-object flashes).
 *   - **Stale delta suppression**: `staleDeltas: Set<string>` marks
 *     `partId`s whose whole-part was already coalesced this tick — any
 *     lingering deltas for that part are dropped (the whole-part covers
 *     their effect).
 *   - **16ms flush timer** (`STREAM_FLUSH_MS`) batches events into one
 *     IPC round trip per paint frame.
 *   - **Monotonic `seq`** per stream connection; renderer detects gaps.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type {
  ConversationBatch,
  ConversationEvent,
} from '../../../preload/api/types';
import { PERF_LOG_ENABLED } from '../../../shared/perf-flag';
import { createLogger } from '../../utils/logger';
import { bridgeEvent } from './event-bridge';
import {
  createCoalesceState,
  drainFlush,
  enqueueEvent,
  type CoalesceState,
} from './event-coalesce';
import { getClient } from './sdk-client';
import {
  handleSessionCompacted,
  handleSessionCreated,
  handleSessionDeleted,
  handleSessionUpdated,
} from './sse-handlers';
import { getMainRpcOrNull } from './rpc';
import { getRegisteredConnectionBySessionId } from './database';
import {
  forwardPermissionAsked,
  forwardPermissionReplied,
  forwardQuestionAsked,
  forwardQuestionReplied,
  type PermissionAskedPayload,
  type PermissionRepliedPayload,
  type PromptForwarderContext,
  type QuestionAskedPayload,
  type QuestionRepliedPayload,
} from './prompt-event-forwarder';
import { getSettingsSnapshot } from './settings-mirror';
import { handleBackgroundSubagentSessionStatus } from './tools/manage-background-subagents';
import { writeSessionLog } from '../../utils/session-logger';
import { abortOpenCodeSession } from './abort';

const log = createLogger('event-stream');

/**
 * Explicit opt-in perf gate. Enabled only when `OPENCODE_PERF_LOG=1` is set.
 * Emits main-side metrics for §6 of STREAMING-REWRITE-PLAN.md:
 *   - Per-flush: seq, event count, server-timestamp (`flushedAt`).
 *   - Every {@link PERF_CPU_SAMPLE_MS}: CPU usage delta (user+system µs).
 *   - Every {@link PERF_HEAP_SAMPLE_MS}: heap used (MB).
 * See `docs/PERF-VALIDATION.md` for how to read the output.
 *
 * NOTE: previously gated on `NODE_ENV !== 'production'`, which meant every
 * dev run paid the sync-disk-write cost of the 16 ms flush timer (~60
 * writes/sec). Now OFF by default in dev too.
 */
const PERF_ENABLED = PERF_LOG_ENABLED;

/** CPU sample cadence during active streaming (ms). */
const PERF_CPU_SAMPLE_MS = 5_000;

/** Heap sample cadence during active streaming (ms). */
const PERF_HEAP_SAMPLE_MS = 30_000;

/** Flush cadence — matches opencode's `STREAM_FLUSH_MS`. */
const STREAM_FLUSH_MS = 16;

/** No-event watchdog — matches opencode's `HEARTBEAT_TIMEOUT_MS`. */
const HEARTBEAT_TIMEOUT_MS = 15_000;

/** Delay between reconnect attempts — matches opencode's `RECONNECT_DELAY_MS`. */
const RECONNECT_DELAY_MS = 250;

/**
 * App-side retry cap. OpenCode's own retry ladder is unbounded (and this
 * build's config schema rejects `experimental.chatMaxRetries`), so a hard
 * provider failure (e.g. a 429 usage-limit that won't reset for hours)
 * retries forever. Once a session's retry `attempt` reaches this cap we
 * abort the run and surface a terminal `session.status` error so the user
 * gets an actionable banner instead of an endless backoff.
 */
const MAX_PROVIDER_RETRY_ATTEMPTS = 3;

/**
 * Sessions we've already auto-aborted this retry cycle. Prevents repeated
 * abort calls while the in-flight retries drain. Cleared when the session
 * leaves the retry state (any non-retry `session.status`).
 */
const autoAbortedSessions = new Set<string>();

/** IPC channel (single channel per merge-plan decision #4). */
const CHANNEL = 'conversation-batch';

// ─── Internal state ──────────────────────────────────────────────────────────

type GetPort = () => number;

type RawEventPayload = {
  id?: string;
  type?: string;
  name?: string;
  properties?: unknown;
  data?: unknown;
  syncEvent?: {
    id?: string;
    type?: string;
    data?: unknown;
  };
};

type BridgeablePayload = {
  id?: string;
  type: string;
  properties?: unknown;
};

type StreamState = {
  getPort: GetPort;
  /**
   * Coalescing state (queue + semantic-key index + stale-delta set).
   * Factored out to `event-coalesce.ts` for pure-function testability.
   */
  coalesce: CoalesceState;
  flushTimer: ReturnType<typeof setTimeout> | null;
  seq: number;
  running: boolean;
  /** Outer reconnect-loop abort controller; cleared on stop(). */
  outerAbort: AbortController | null;
  /** Current attempt abort controller; reset on each reconnect. */
  attemptAbort: AbortController | null;
  /** Heartbeat timer for the current attempt. */
  heartbeat: ReturnType<typeof setTimeout> | null;
  /** Promise of the active loop so stop() can await graceful shutdown. */
  loopPromise: Promise<void> | null;
  /** Perf sampler timers (dev-only; null when disabled). */
  perfCpuTimer: ReturnType<typeof setInterval> | null;
  perfHeapTimer: ReturnType<typeof setInterval> | null;
  /** Last CPU sample for delta computation. */
  perfLastCpu: NodeJS.CpuUsage | null;
  perfLastCpuAt: number;
  /** Consecutive failed SSE connect attempts; 0 while connected. */
  reconnectAttempts: number;
};

let state: StreamState | null = null;

// ─── Prompt-forwarder context builder ────────────────────────────────────────

/**
 * Build the `PromptForwarderContext` used by the out-of-band prompt
 * forwarders (`forwardPermissionAsked` etc). Produces a `sendToRenderer`
 * closure that forwards envelopes through the main-side supervisor via
 * `bridge.emit('to-renderer', ...)`, and pulls settings from the
 * utility-side mirror so the forwarders stay free of Electron / settings
 * imports and remain trivially unit-testable.
 */
function buildPromptForwarderContext(port: number): PromptForwarderContext {
  return {
    sendToRenderer: (channel, payload) => {
      const bridge = getMainRpcOrNull();
      bridge?.emit('to-renderer', { channel, payload });
    },
    resolveConnection: async (sessionId: string) => {
      try {
        const rc = getRegisteredConnectionBySessionId(sessionId, 'opencode');
        return { connectionId: rc?.connectionId ?? null };
      } catch {
        return { connectionId: null };
      }
    },
    getAllowedPermissions: () => getSettingsSnapshot().allowedPermissions,
    getAllowedReadFolders: () => getSettingsSnapshot().allowedReadFolders,
    getOpenCodePort: () => port,
  };
}

// ─── Coalescing helpers ──────────────────────────────────────────────────────

/**
 * Enqueue a single event into the pending batch, delegating the
 * coalescing rules to `event-coalesce.ts`. Schedules a flush.
 */
function enqueue(event: ConversationEvent): void {
  if (!state) return;
  enqueueEvent(state.coalesce, event);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (!state || state.flushTimer !== null) return;
  state.flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
}

function flush(): void {
  if (!state) return;
  state.flushTimer = null;

  if (state.coalesce.queue.length === 0) return;

  const events = drainFlush(state.coalesce);

  const batch: ConversationBatch = {
    seq: ++state.seq,
    events,
    flushedAt: Date.now(),
  };

  // Reset per-tick state BEFORE sending so that any re-entrant emits
  // (should not happen with our producers, but cheap insurance) start a
  // fresh coalescing pass.
  state.coalesce = createCoalesceState();

  const bridge = getMainRpcOrNull();
  if (!bridge) return;
  try {
    bridge.emit('to-renderer', { channel: CHANNEL, payload: batch });
    if (PERF_ENABLED) {
      log.info(
        `[perf.flush] seq=${batch.seq} count=${events.length} flushedAt=${batch.flushedAt}`,
      );
    }
  } catch (err) {
    log.warn(`Failed to send batch seq=${batch.seq}: ${String(err)}`);
  }
}

// ─── Connection status ───────────────────────────────────────────────────────

/**
 * Surface SSE pump connectivity to the renderer. Routed through the same
 * coalescing batch pipeline (semantic key `conn:global`), so rapid
 * reconnect cycles collapse to the latest state per flush tick.
 */
function emitConnectionStatus(status: 'connected' | 'reconnecting'): void {
  if (!state) return;
  enqueue({
    type: 'connection.status',
    status,
    attempt: state.reconnectAttempts,
  });
}

/**
 * Abort a session whose provider retry `attempt` has reached the cap, and
 * emit a terminal `session.status` error so the renderer's banner switches
 * from "retrying…" to an actionable error. Idempotent per retry cycle via
 * {@link autoAbortedSessions}.
 */
function maybeAutoAbortRetry(
  port: number,
  sessionId: string,
  retry: { attempt: number; message: string },
): void {
  if (retry.attempt < MAX_PROVIDER_RETRY_ATTEMPTS) return;
  if (autoAbortedSessions.has(sessionId)) return;
  autoAbortedSessions.add(sessionId);

  writeSessionLog(
    getSettingsSnapshot().logsDir,
    sessionId,
    'WARN',
    'retry-cap',
    `attempt=${retry.attempt} reached cap=${MAX_PROVIDER_RETRY_ATTEMPTS} — aborting session`,
  );

  void abortOpenCodeSession(port, sessionId)
    .catch((err) => {
      log.warn(`auto-abort failed for session=${sessionId}: ${String(err)}`);
      return false;
    })
    .finally(() => {
      // Surface a terminal error regardless of abort outcome — the user
      // needs the banner to stop saying "retrying" after the cap.
      emitConversationEvent({
        type: 'session.status',
        sessionId,
        status: 'error',
        error: `Stopped after ${MAX_PROVIDER_RETRY_ATTEMPTS} retries: ${retry.message}`,
      });
    });
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

function resetHeartbeat(): void {
  if (!state) return;
  if (state.heartbeat !== null) clearTimeout(state.heartbeat);
  state.heartbeat = setTimeout(() => {
    log.warn(
      `Heartbeat timeout (${HEARTBEAT_TIMEOUT_MS}ms) — aborting attempt`,
    );
    state?.attemptAbort?.abort();
  }, HEARTBEAT_TIMEOUT_MS);
}

function clearHeartbeat(): void {
  if (!state) return;
  if (state.heartbeat !== null) {
    clearTimeout(state.heartbeat);
    state.heartbeat = null;
  }
}

// ─── Perf samplers (dev-only) ────────────────────────────────────────────────

function startPerfSamplers(): void {
  if (!PERF_ENABLED || !state) return;
  state.perfLastCpu = process.cpuUsage();
  state.perfLastCpuAt = Date.now();
  state.perfCpuTimer = setInterval(() => {
    if (!state) return;
    const now = Date.now();
    const elapsedMs = now - state.perfLastCpuAt;
    if (elapsedMs <= 0) return;
    const delta = process.cpuUsage(state.perfLastCpu ?? undefined);
    state.perfLastCpu = process.cpuUsage();
    state.perfLastCpuAt = now;
    // cpuUsage returns microseconds; percent = total µs / (elapsed ms * 1000 µs/ms * cores) * 100.
    // We report single-core % (unclamped) to match Activity Monitor's per-process view.
    const totalMicros = delta.user + delta.system;
    const pct = ((totalMicros / (elapsedMs * 1000)) * 100).toFixed(1);
    log.info(
      `[perf.cpu] user=${delta.user}µs system=${delta.system}µs window=${elapsedMs}ms pct=${pct}%`,
    );
  }, PERF_CPU_SAMPLE_MS);

  state.perfHeapTimer = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
    log.info(`[perf.heap] heapUsed=${heapMb}MB rss=${rssMb}MB`);
  }, PERF_HEAP_SAMPLE_MS);
}

function stopPerfSamplers(): void {
  if (!state) return;
  if (state.perfCpuTimer !== null) {
    clearInterval(state.perfCpuTimer);
    state.perfCpuTimer = null;
  }
  if (state.perfHeapTimer !== null) {
    clearInterval(state.perfHeapTimer);
    state.perfHeapTimer = null;
  }
  state.perfLastCpu = null;
}

// ─── SSE loop ────────────────────────────────────────────────────────────────

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.message.toLowerCase().includes('abort')) return true;
  }
  return false;
}

function getSessionLifecycleType(
  payloadType: string | undefined,
): 'session.created' | 'session.updated' | 'session.deleted' | null {
  if (!payloadType) return null;
  if (
    payloadType === 'session.created' ||
    payloadType === 'session.created.1'
  ) {
    return 'session.created';
  }
  if (
    payloadType === 'session.updated' ||
    payloadType === 'session.updated.1'
  ) {
    return 'session.updated';
  }
  if (
    payloadType === 'session.deleted' ||
    payloadType === 'session.deleted.1'
  ) {
    return 'session.deleted';
  }
  return null;
}

function stripSyncVersion(type: string): string {
  return type.replace(/\.\d+$/, '');
}

function normalizeSessionNextPayload(
  payload: RawEventPayload | undefined,
): BridgeablePayload | null {
  if (!payload?.type) return null;
  if (payload.type !== 'sync') {
    return payload.type.startsWith('session.next.')
      ? { ...payload, type: payload.type }
      : (payload as BridgeablePayload);
  }

  const syncType = payload.syncEvent?.type ?? payload.name;
  if (!syncType) return null;

  const type = stripSyncVersion(syncType);
  if (!type.startsWith('session.next.')) return null;

  return {
    id: payload.syncEvent?.id ?? payload.id,
    type,
    properties: payload.syncEvent?.data ?? payload.data,
  };
}

function normalizeStreamEnvelope(envelope: unknown): {
  directory?: string | null;
  payload?: RawEventPayload;
} {
  const value = envelope as RawEventPayload & {
    directory?: string | null;
    payload?: RawEventPayload;
  };
  if (value?.payload) return value;
  return { directory: null, payload: value };
}

/**
 * Outer reconnect loop. Opens an SSE stream via the SDK, pumps events
 * through the coalescing queue, and reconnects on any termination (error,
 * heartbeat abort, stream end) unless the outer controller was aborted.
 */
async function runLoop(): Promise<void> {
  if (!state) return;
  const outer = state.outerAbort;
  if (!outer) return;

  while (!outer.signal.aborted && state?.running) {
    const attempt = new AbortController();
    if (state) state.attemptAbort = attempt;

    const onOuterAbort = () => attempt.abort();
    outer.signal.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const port = state.getPort();
      const client = getClient(port);

      log.info(`Opening SSE stream on port=${port}`);
      const result = await client.global.event({
        signal: attempt.signal,
        onSseError: (err: unknown) => {
          if (isAbortError(err)) return;
          log.warn(`SSE transport error: ${String(err)}`);
        },
      });

      resetHeartbeat();

      // Stream handshake succeeded — clear any reconnecting indicator.
      if (state) state.reconnectAttempts = 0;
      emitConnectionStatus('connected');

      for await (const envelope of result.stream) {
        resetHeartbeat();

        // `sync` frames are bulk catch-up payloads on reconnect; we don't
        // need them — the REST seed (C2 follow-up) fetches the canonical
        // message list on mount, and live events fill in from there.
        const typedEnvelope = normalizeStreamEnvelope(envelope);
        const payload = normalizeSessionNextPayload(typedEnvelope?.payload) as
          | (BridgeablePayload & {
              properties?: { sessionID?: string; info?: unknown };
            })
          | null;
        if (!payload) continue;

        // Session lifecycle events feed the session-tree manager cache.
        // These carry the authoritative `Session` shape and are distinct
        // from the conversation pipeline — route them and continue so
        // `bridgeEvent` does not see them.
        const lifecycleType = getSessionLifecycleType(payload.type);
        if (lifecycleType) {
          const props = payload.properties as
            Parameters<typeof handleSessionCreated>[0] | undefined;
          if (props && props.info) {
            if (lifecycleType === 'session.created')
              handleSessionCreated(props, {
                getOpenCodePort: state.getPort,
                getAutoRegisterSubagents: () =>
                  getSettingsSnapshot().autoRegisterSubagents,
              });
            else if (lifecycleType === 'session.updated')
              handleSessionUpdated(props);
            else handleSessionDeleted(props);
          }
          continue;
        }

        // Session compaction re-injection: OpenCode's auto-summarize rewrites
        // the visible message history with a condensed summary, dropping
        // previously-injected `<system-reminder>` blocks from the context
        // window. Re-inject the DB skills/instructions context so the agent
        // continues to see the same standing rules after compaction.
        //
        // NOTE: We do NOT `continue` here — `bridgeEvent` below also handles
        // `session.compacted` to emit the renderer-facing
        // `session.compaction-done` signal. Both paths must run.
        if (
          payload.type === 'session.compacted' ||
          payload.type === 'session.compacted.1'
        ) {
          const sessionId = (
            payload.properties as { sessionID?: string } | undefined
          )?.sessionID;
          if (typeof sessionId === 'string' && sessionId.length > 0) {
            handleSessionCompacted(sessionId, {
              getOpenCodePort: state.getPort,
              getAutoRegisterSubagents: () =>
                getSettingsSnapshot().autoRegisterSubagents,
            });
          }
        }

        // Permission & question prompts run out-of-band (same pattern as
        // session.created/updated/deleted above). They are control-plane
        // signals that must reach the renderer immediately with their
        // `connectionId` + `providerSessionId` routing fields intact, so
        // they bypass the 16ms coalesce/batch pipeline used for
        // conversation data.
        //
        // `permission.asked` runs auto-approve first; auto-approved
        // requests reply via the OpenCode HTTP API and never reach the
        // renderer at all (no flash of a pending permission toast).
        if (payload.type === 'permission.asked') {
          const promptCtx = buildPromptForwarderContext(port);
          void forwardPermissionAsked(
            {
              ...(payload.properties as PermissionAskedPayload),
              directory: typedEnvelope.directory ?? undefined,
            },
            promptCtx,
          );
          continue;
        }

        if (payload.type === 'permission.replied') {
          const promptCtx = buildPromptForwarderContext(port);
          forwardPermissionReplied(
            payload.properties as PermissionRepliedPayload,
            promptCtx,
          );
          continue;
        }

        if (payload.type === 'question.asked') {
          const promptCtx = buildPromptForwarderContext(port);
          forwardQuestionAsked(
            payload.properties as QuestionAskedPayload,
            promptCtx,
          );
          continue;
        }

        if (
          payload.type === 'question.replied' ||
          payload.type === 'question.rejected'
        ) {
          const promptCtx = buildPromptForwarderContext(port);
          const props = payload.properties as QuestionRepliedPayload;
          forwardQuestionReplied(
            {
              ...props,
              rejected: payload.type === 'question.rejected',
            },
            promptCtx,
          );
          continue;
        }

        const mapped = bridgeEvent(
          payload as Parameters<typeof bridgeEvent>[0],
          {
            directory: typedEnvelope.directory ?? null,
            port,
          },
        );
        for (const ev of mapped) {
          if (ev.type === 'session.status') {
            const status =
              ev.status === 'streaming'
                ? 'busy'
                : ev.status === 'error'
                  ? 'error'
                  : 'idle';
            void handleBackgroundSubagentSessionStatus({
              openCodePort: port,
              sessionId: ev.sessionId,
              status,
            });
            // Ground-truth trace for provider backoff / session errors —
            // these drive the renderer's SessionIssueBanner.
            if (ev.retry || ev.status === 'error') {
              writeSessionLog(
                getSettingsSnapshot().logsDir,
                ev.sessionId,
                'INFO',
                'sse:session.status',
                ev.retry
                  ? `retry attempt=${ev.retry.attempt} next=${ev.retry.next} message=${ev.retry.message}`
                  : `error=${ev.error ?? '(none)'}`,
              );
            }
            // App-side retry cap — abort once attempts exceed the cap.
            if (ev.retry) {
              maybeAutoAbortRetry(port, ev.sessionId, ev.retry);
            } else {
              // Left the retry state — reset the per-session abort guard.
              autoAbortedSessions.delete(ev.sessionId);
            }
          } else if (ev.type === 'session.next.model.switched') {
            writeSessionLog(
              getSettingsSnapshot().logsDir,
              ev.sessionId,
              'INFO',
              'sse:session.next.model.switched',
              `model=${ev.providerId}/${ev.modelId}/${ev.variant ?? 'default'}`,
            );
          } else if (ev.type === 'session.next.step.started') {
            writeSessionLog(
              getSettingsSnapshot().logsDir,
              ev.sessionId,
              'INFO',
              'sse:session.next.step.started',
              `messageId=${ev.messageId} agent=${ev.agent ?? '(none)'} model=${ev.providerId}/${ev.modelId}/${ev.variant ?? 'default'}`,
            );
          }
        }
        for (const ev of mapped) enqueue(ev);
      }

      log.info('SSE stream ended normally — reconnecting');
    } catch (err) {
      if (!isAbortError(err)) {
        log.warn(`SSE attempt failed: ${String(err)}`);
      }
    } finally {
      outer.signal.removeEventListener('abort', onOuterAbort);
      clearHeartbeat();
      if (state) state.attemptAbort = null;
    }

    if (outer.signal.aborted || !state?.running) return;

    // Any path here (error, heartbeat abort, clean stream end) means the
    // stream is down and we're about to retry — tell the renderer.
    state.reconnectAttempts += 1;
    emitConnectionStatus('reconnecting');

    // Short delay before the next attempt. SDK has its own exponential
    // backoff for network-level retries; this is the outer ladder.
    await wait(RECONNECT_DELAY_MS, outer.signal);
  }
}

// ─── Public lifecycle ────────────────────────────────────────────────────────

export type StartEventStreamOptions = {
  /**
   * Returns the current OpenCode server port. Called on every reconnect
   * so port changes (e.g., settings update) take effect on next attempt.
   */
  getPort: GetPort;
};

/**
 * Start the conversation event stream.
 *
 * The stream runs until `stopEventStream()` is called. Failures trigger
 * automatic reconnect with a 250ms delay ladder; 15s heartbeat timeout
 * aborts wedged attempts.
 */
export function startEventStream(options: StartEventStreamOptions): void {
  if (state?.running) {
    log.warn('startEventStream called twice; ignoring second call.');
    return;
  }

  state = {
    getPort: options.getPort,
    coalesce: createCoalesceState(),
    flushTimer: null,
    seq: 0,
    running: true,
    outerAbort: new AbortController(),
    attemptAbort: null,
    heartbeat: null,
    loopPromise: null,
    perfCpuTimer: null,
    perfHeapTimer: null,
    perfLastCpu: null,
    perfLastCpuAt: 0,
    reconnectAttempts: 0,
  };

  log.info('Event stream started');
  startPerfSamplers();
  state.loopPromise = runLoop().catch((err) => {
    log.warn(`runLoop crashed: ${String(err)}`);
  });
}

/**
 * Tear down the event stream on app quit. Idempotent.
 */
export function stopEventStream(): void {
  if (!state) return;
  state.running = false;
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  clearHeartbeat();
  stopPerfSamplers();
  autoAbortedSessions.clear();
  state.outerAbort?.abort();
  state.attemptAbort?.abort();
  state = null;
  log.info('Event stream stopped');
}

/**
 * Test/producer seam — direct enqueue bypassing the SSE loop. Used by C5
 * merge work to push `session.status` updates from `tree-manager` or
 * other producers through the same coalescing queue.
 */
export function emitConversationEvent(event: ConversationEvent): void {
  enqueue(event);
}
