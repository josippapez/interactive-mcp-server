/**
 * Shared types for the session-tree manager modules.
 */

import type { RegisteredConnection } from '../../database';
import type { OpenCodeSession } from '../../opencode/session';

// ─── Sync event payload shapes ───────────────────────────────────────────────

/**
 * Legacy / flat sync event payload shape. Older OpenCode builds (and our test
 * fixtures) emit events directly on `payload`. Retained for back-compat.
 */
export interface FlatSyncEventPayload {
  type: string;
  aggregate?: string;
  data: Record<string, unknown>;
}

/**
 * The versioned sync event the current OpenCode (`packages/opencode/src/sync`)
 * publishes on `/global/event`. Wrapped in `{ payload: { type: "sync",
 * syncEvent: {...} } }`.
 */
export interface WrappedSyncEventPayload {
  type: 'sync';
  syncEvent: {
    type: string;
    id?: string;
    seq?: number;
    aggregateID?: string;
    data: Record<string, unknown>;
  };
}

export type SyncEventPayload = FlatSyncEventPayload | WrappedSyncEventPayload;

export interface SyncEventEnvelope {
  payload: SyncEventPayload;
}

/**
 * Runtime helper to unwrap the real event `{ type, data }` from either
 * shape. Returns `null` when the envelope is malformed.
 */
export function extractSyncEvent(
  envelope: SyncEventEnvelope,
): { type: string; data: Record<string, unknown> } | null {
  const payload = envelope?.payload;
  if (!payload || typeof payload !== 'object') return null;

  if ((payload as WrappedSyncEventPayload).type === 'sync') {
    const inner = (payload as WrappedSyncEventPayload).syncEvent;
    if (!inner || typeof inner.type !== 'string' || !inner.data) return null;
    return { type: inner.type, data: inner.data };
  }

  const flat = payload as FlatSyncEventPayload;
  if (typeof flat.type !== 'string' || !flat.data) return null;
  return { type: flat.type, data: flat.data };
}

export interface SessionInfo {
  id: string;
  parentID?: string | null;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
  /** Git version string from OpenCode (e.g., "0.0.0-work/feature-branch-123") */
  version?: string;
  /** Change summary from OpenCode */
  summary?: { additions?: number; deletions?: number; files?: number };
}

// ─── Public data types ───────────────────────────────────────────────────────

/** VCS (version control) information extracted from OpenCode session. */
export interface VcsInfo {
  /** Git branch name extracted from version string. */
  branch: string | null;
  /** Number of added lines. */
  additions: number;
  /** Number of deleted lines. */
  deletions: number;
  /** Number of changed files. */
  files: number;
}

/** The data shape emitted over IPC to the renderer per session. */
export interface SessionNodeData {
  /** Canonical provider-session identity (e.g. OpenCode `ses_xxx`) — stable primary key. */
  providerSessionId: string;
  /** Parent's provider session ID, or null for root sessions. */
  openCodeParentId: string | null;
  /** Human-readable title from OpenCode (may be auto-generated). */
  title: string;
  /** Working directory reported by OpenCode. */
  directory: string;
  /** Unix ms timestamp from OpenCode. */
  createdAt: number;
  /** Unix ms timestamp from OpenCode. */
  updatedAt: number;
  /** 0 = root/main agent, 1 = direct subagent, etc. */
  depth: number;
  /**
   * MCP connectionId — set when the agent called register_connection.
   * This is the key used by prompt/channel events.
   */
  connectionId: string | null;
  /** Display name from register_connection, or null if not yet registered. */
  channelName: string | null;
  /** Whether this session has an active MCP channel. */
  hasMcpChannel: boolean;
  /** baseDirectory from the registered connection record, if any. */
  baseDirectory: string | null;
  /** OpenCode parent session ID from the registered connection record, if any. */
  registeredParentSessionId: string | null;
  /** Provider type for this connection (opencode, copilot-cli, claude-sdk, standalone). */
  providerType: RegisteredConnection['providerType'] | null;
  /** VCS (git) information for this session. */
  vcsInfo: VcsInfo | null;
}

// ─── Timing constants ────────────────────────────────────────────────────────

/** Reconnect delay when the SSE stream drops (ms). */
export const SSE_RECONNECT_DELAY_MS = 2_000;

/** Minimum interval between snapshot emissions to avoid flooding the renderer. */
export const SNAPSHOT_DEBOUNCE_MS = 50;

// ─── Re-export for backwards-compat ──────────────────────────────────────────
export type { OpenCodeSession };
