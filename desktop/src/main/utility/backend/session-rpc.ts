/**
 * Bridge RPC handlers for session resolution, auto-register, and tree services.
 *
 * Registered once by `entry.ts` after the DB is initialised and the main RPC
 * accessor is installed. Each handler dispatches to one utility-local function;
 * the main-side proxy lives in `utility/session-client.ts`.
 */

import type { Bridge } from '../bridge';
import {
  resolveSession,
  reResolveStaleSession,
  resolveProviderSessionId,
  type ResolverOptions,
  type ResolvedSession,
} from './resolver';
import {
  autoRegisterSession,
  reinjectDbContextAfterCompaction,
} from './auto-register';
import type { SessionInfo } from './session-types';
import {
  startSessionTreeService,
  stopSessionTreeService,
  fetchSessionTree,
  increaseSessionTreeLimit,
  invalidateSessionTree,
  invalidateSessionTreeForKey,
  tombstoneOpenCodeSession,
  getSelectedFolder,
  getShowArchivedSessions,
  setOpenCodeSessionArchived,
  setSelectedFolder,
  setShowArchivedSessions,
} from './session-tree-service';
import { reconcileSessionConnections } from './session-reconnect';
import { startMissingIndexesForRegisteredConnections } from './repository-index/autostart';

interface ArgsEnvelope {
  args?: unknown[];
}

function argsOf(payload: unknown): unknown[] {
  return (payload as ArgsEnvelope | undefined)?.args ?? [];
}

let treeServiceStarted = false;
let treePortGetter: (() => number) | null = null;

export function registerSessionRpcHandlers(bridge: Bridge): void {
  // ── Resolver ─────────────────────────────────────────────────────────────
  bridge.handle('session.resolveSession', async (payload) => {
    const [opts] = argsOf(payload) as [ResolverOptions];
    const result: ResolvedSession = await resolveSession(opts);
    return result;
  });

  bridge.handle('session.reResolveStaleSession', async (payload) => {
    const [opts] = argsOf(payload) as [ResolverOptions];
    const result: ResolvedSession = await reResolveStaleSession(opts);
    return result;
  });

  bridge.handle('session.resolveProviderSessionId', (payload) => {
    const [connectionId, explicitSessionId, providerType] = argsOf(payload) as [
      string,
      string | null | undefined,
      'opencode' | 'claude_sdk' | 'standalone' | 'copilot_cli' | undefined,
    ];
    return resolveProviderSessionId(
      connectionId,
      explicitSessionId ?? undefined,
      providerType,
    );
  });

  // ── Auto-register ────────────────────────────────────────────────────────
  bridge.handle('session.autoRegisterSession', (payload) => {
    const [info, openCodePort, invalidate] = argsOf(payload) as [
      SessionInfo,
      number,
      boolean | undefined,
    ];
    autoRegisterSession(info, {
      getOpenCodePort: () => openCodePort,
      invalidate: invalidate ?? true,
    });
    return { ok: true };
  });

  bridge.handle('session.reinjectDbContextAfterCompaction', (payload) => {
    const [sessionId, openCodePort] = argsOf(payload) as [string, number];
    reinjectDbContextAfterCompaction(sessionId, {
      getOpenCodePort: () => openCodePort,
    });
    return { ok: true };
  });

  // ── Tree service ─────────────────────────────────────────────────────────
  // Main-side code used to call startSessionTreeService with a BrowserWindow
  // accessor; now the utility owns it and pushes invalidations via
  // `to-renderer`. The "start" RPC just installs the port getter (latest value).
  bridge.handle('session.tree.start', (payload) => {
    const [openCodePort] = argsOf(payload) as [number];
    treePortGetter = () => openCodePort;
    if (!treeServiceStarted) {
      startSessionTreeService(() => treePortGetter?.() ?? openCodePort);
      startMissingIndexesForRegisteredConnections();
      treeServiceStarted = true;
    }
    return { ok: true };
  });

  bridge.handle('session.tree.stop', () => {
    stopSessionTreeService();
    treeServiceStarted = false;
    treePortGetter = null;
    return { ok: true };
  });

  bridge.handle('session.tree.fetch', async () => {
    return fetchSessionTree();
  });

  bridge.handle('session.tree.loadMore', () => {
    return increaseSessionTreeLimit('');
  });

  bridge.handle('session.tree.loadMoreForDirectory', (payload) => {
    const [baseDirectory] = argsOf(payload) as [string];
    return increaseSessionTreeLimit(baseDirectory);
  });

  bridge.handle('session.tree.invalidate', () => {
    invalidateSessionTree();
    return { ok: true };
  });

  bridge.handle('session.tree.invalidateForKey', (payload) => {
    const [key] = argsOf(payload) as [string];
    invalidateSessionTreeForKey(key);
    return { ok: true };
  });

  bridge.handle('session.tree.tombstone', (payload) => {
    const [sessionId] = argsOf(payload) as [string];
    tombstoneOpenCodeSession(sessionId);
    return { ok: true };
  });

  bridge.handle('session.tree.getSelectedFolder', () => {
    return getSelectedFolder();
  });

  bridge.handle('session.tree.setSelectedFolder', (payload) => {
    const [folder] = argsOf(payload) as [string | null];
    setSelectedFolder(folder);
    return { ok: true };
  });

  bridge.handle('session.tree.getShowArchived', () => {
    return getShowArchivedSessions();
  });

  bridge.handle('session.tree.setShowArchived', (payload) => {
    const [showArchived] = argsOf(payload) as [boolean];
    setShowArchivedSessions(showArchived);
    return { ok: true };
  });

  bridge.handle('session.tree.archive', (payload) => {
    const [sessionId, archived] = argsOf(payload) as [string, boolean];
    return setOpenCodeSessionArchived(sessionId, archived);
  });

  // Keep the port getter current when the tree service is already running
  // (allows main to push openCodePort updates without a restart).
  bridge.on('session.tree.setPort', (payload) => {
    const p = payload as { port?: number } | undefined;
    if (typeof p?.port === 'number') {
      treePortGetter = () => p.port as number;
    }
  });

  // ── Reconcile ────────────────────────────────────────────────────────────
  bridge.handle('session.reconcileSessionConnections', async (payload) => {
    const [openCodePort, baseDirectory] = argsOf(payload) as [
      number,
      string | null,
    ];
    return reconcileSessionConnections(openCodePort, baseDirectory);
  });
}
