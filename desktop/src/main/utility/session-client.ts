/**
 * Main-side proxy client for session resolver, auto-register, and tree-service
 * functions that now live in the utility process.
 *
 * Mirrors the APIs originally exposed by `session/resolver.ts`,
 * `session/auto-register.ts`, `session/session-tree-service.ts` and
 * `session/reconnect.ts`, but returns promises that dispatch over the
 * utility-process bridge.
 *
 * Utility-local callers MUST NOT import this file; they import the backend
 * module directly.
 */
import type { Bridge } from './bridge';
import { getUtilitySupervisor } from './supervisor';
import type {
  ResolvedSession,
  ResolverOptions,
  ResolutionMethod,
} from './backend/resolver';
import type {
  SessionInfo,
  SessionNodeData,
  SessionTreeResult,
  VcsInfo,
} from './backend/session-types';
import type { ReconnectResult } from './backend/session-reconnect';

export type {
  ResolvedSession,
  ResolverOptions,
  ResolutionMethod,
  SessionInfo,
  SessionNodeData,
  SessionTreeResult,
  VcsInfo,
  ReconnectResult,
};

function bridge(): Bridge {
  return getUtilitySupervisor().getBridge();
}

function call<T>(name: string, args: unknown[]): Promise<T> {
  return bridge().request<T>(name, { args });
}

// ─── Resolver ────────────────────────────────────────────────────────────
export function resolveSession(
  opts: ResolverOptions,
): Promise<ResolvedSession> {
  return call('session.resolveSession', [opts]);
}

export function reResolveStaleSession(
  opts: ResolverOptions,
): Promise<ResolvedSession> {
  return call('session.reResolveStaleSession', [opts]);
}

export function resolveProviderSessionId(
  connectionId: string,
  explicitSessionId?: string | null,
  providerType?: 'opencode' | 'claude_sdk' | 'standalone' | 'copilot_cli',
): Promise<string | null> {
  return call('session.resolveProviderSessionId', [
    connectionId,
    explicitSessionId ?? null,
    providerType,
  ]);
}

// ─── Auto-register ───────────────────────────────────────────────────────
export function autoRegisterSession(
  info: SessionInfo,
  openCodePort: number,
  invalidate = true,
): Promise<{ ok: boolean }> {
  return call('session.autoRegisterSession', [info, openCodePort, invalidate]);
}

export function reinjectDbContextAfterCompaction(
  sessionId: string,
  openCodePort: number,
): Promise<{ ok: boolean }> {
  return call('session.reinjectDbContextAfterCompaction', [
    sessionId,
    openCodePort,
  ]);
}

// ─── Tree service ────────────────────────────────────────────────────────
export function startSessionTreeService(openCodePort: number): Promise<void> {
  return call<void>('session.tree.start', [openCodePort]);
}

export function stopSessionTreeService(): Promise<void> {
  // Shutdown-tolerant: during `before-quit`, the utility supervisor may
  // dispose the bridge before this request completes. Swallow bridge/dispose
  // errors so callers fire-and-forget cleanly.
  try {
    return call<void>('session.tree.stop', []).catch(() => {
      // no-op — bridge disposed or child already exited
    });
  } catch {
    return Promise.resolve();
  }
}

export function fetchSessionTree(): Promise<SessionTreeResult | null> {
  return call('session.tree.fetch', []);
}

export function loadMoreSessionTree(): Promise<number> {
  return call('session.tree.loadMore', []);
}

export function loadMoreSessionTreeForDirectory(
  baseDirectory: string,
): Promise<number> {
  return call('session.tree.loadMoreForDirectory', [baseDirectory]);
}

export function invalidateSessionTree(): Promise<void> {
  return call<void>('session.tree.invalidate', []);
}

export function invalidateSessionTreeForKey(key: string): Promise<void> {
  return call<void>('session.tree.invalidateForKey', [key]);
}

export function tombstoneOpenCodeSession(sessionId: string): Promise<void> {
  return call<void>('session.tree.tombstone', [sessionId]);
}

export function getSelectedFolder(): Promise<string | null> {
  return call('session.tree.getSelectedFolder', []);
}

export function setSelectedFolder(folder: string | null): Promise<void> {
  return call<void>('session.tree.setSelectedFolder', [folder]);
}

// ─── Reconcile ───────────────────────────────────────────────────────────
export function reconcileSessionConnections(
  openCodePort: number,
  baseDirectory: string | null,
): Promise<ReconnectResult> {
  return call('session.reconcileSessionConnections', [
    openCodePort,
    baseDirectory,
  ]);
}
