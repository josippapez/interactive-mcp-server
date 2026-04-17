/**
 * Module-level mutable state for the session-tree manager.
 *
 * All sub-modules import from this file to read/write shared state.
 * Keeping state centralized avoids circular imports between domain modules.
 */

import type { BrowserWindow } from 'electron';
import type { SessionInfo } from './types';

// ─── Live caches ─────────────────────────────────────────────────────────────

/** Live session cache: sessionId → SessionInfo */
export const _sessionCache = new Map<string, SessionInfo>();

/**
 * In-memory set of OpenCode session IDs that have been explicitly deleted by
 * the user via the Desktop app. Sessions in this set are excluded from every
 * subsequent snapshot.
 */
export const _tombstonedSessionIds = new Set<string>();

/**
 * Ring buffer of recently registered connections (connectionId → timestamp).
 * Used by auto-bind to find unbound connections within AUTO_BIND_WINDOW_MS.
 *
 * Phase 2 exception: this map is intentionally keyed by `connectionId` (not
 * `providerSessionId`). At the moment a connection is recorded here it has
 * NOT yet been bound to an OpenCode session — that binding is exactly what
 * `tryAutoBindSession` performs. The transport-level `connectionId` is the
 * only stable identifier available at registration time. Do not rekey this
 * map as part of the provider-session-id unification.
 */
export const _pendingConnections = new Map<string, number>();

// ─── Lifecycle state ─────────────────────────────────────────────────────────

export const state = {
  sseAbortController: null as AbortController | null,
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  snapshotTimer: null as ReturnType<typeof setTimeout> | null,
  restSeedCompleted: false,
  // Instrumentation for SSE reconnect thrash — does not fix the thrash itself.
  sseReconnectCount: 0,
  sseLastConnectedAt: null as number | null,
  /**
   * Flag indicating that a snapshot was requested but could not be emitted
   * (e.g., window unavailable). When true, the next scheduleSnapshot call
   * or window availability check should emit immediately.
   */
  snapshotPending: false,
  getWindow: null as (() => BrowserWindow | null) | null,
  getOpenCodePort: null as (() => number) | null,
  getAutoRegisterSubagents: null as (() => boolean) | null,
};
