/**
 * SSE handlers for OpenCode session lifecycle events
 * (`session.created` / `session.updated` / `session.deleted`).
 *
 * Lives inside the utility process as of Phase 2. Main-process-only
 * responsibilities — the DB-backed auto-register path, session-tree cache
 * invalidation, tombstoning — are delegated back across the Bridge via
 * RPC/emit so utility code never touches better-sqlite3 directly.
 */

import type { Session } from '@opencode-ai/sdk';
import {
  autoRegisterSession,
  reinjectDbContextAfterCompaction,
} from './auto-register';
import {
  invalidateSessionTree,
  invalidateSessionTreeForKey,
  tombstoneOpenCodeSession,
} from './session-tree-service';
import type { SessionInfo } from './session-types';

type SessionEventProperties = {
  sessionID: string;
  info: Session;
};

export interface SessionSseHandlerOptions {
  getOpenCodePort: () => number;
  getAutoRegisterSubagents: () => boolean;
}

function toSessionInfo(info: Session): SessionInfo {
  return {
    id: info.id,
    parentID: info.parentID ?? null,
    title: info.title,
    directory: info.directory,
    time: info.time,
    version: info.version,
    summary: info.summary
      ? {
          additions: info.summary.additions,
          deletions: info.summary.deletions,
          files: info.summary.files,
        }
      : undefined,
  };
}

// ─── Public handlers ────────────────────────────────────────────────────────

export function handleSessionCreated(
  props: SessionEventProperties,
  options: SessionSseHandlerOptions,
): void {
  const { info } = props;
  if (!info || typeof info.id !== 'string') return;

  const next = toSessionInfo(info);

  if (options.getAutoRegisterSubagents()) {
    const port = options.getOpenCodePort();
    try {
      autoRegisterSession(next, { getOpenCodePort: () => port });
    } catch (err) {
      console.warn(`[sse-handlers] autoRegisterSession failed: ${String(err)}`);
    }
  }

  invalidateSessionTree();
}

export function handleSessionUpdated(props: SessionEventProperties): void {
  const { info } = props;
  if (!info || typeof info.id !== 'string') return;
  invalidateSessionTreeForKey(info.id);
}

export function handleSessionDeleted(props: SessionEventProperties): void {
  const { sessionID, info } = props;
  const id = sessionID ?? info?.id;
  if (typeof id !== 'string' || id.length === 0) return;

  tombstoneOpenCodeSession(id);
  invalidateSessionTree();
}

/**
 * Handle `session.compacted` SSE events. Utility-local now — compaction
 * re-injects standing `<system-reminder>` skills/instructions so agents
 * keep their rules after OpenCode rewrites the history.
 */
export function handleSessionCompacted(
  sessionId: string,
  options: SessionSseHandlerOptions,
): void {
  if (!sessionId) return;
  const port = options.getOpenCodePort();
  try {
    reinjectDbContextAfterCompaction(sessionId, {
      getOpenCodePort: () => port,
    });
  } catch (err) {
    console.warn(
      `[sse-handlers] reinjectDbContextAfterCompaction failed: ${String(err)}`,
    );
  }
}
