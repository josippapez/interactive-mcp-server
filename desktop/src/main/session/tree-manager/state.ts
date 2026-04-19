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
