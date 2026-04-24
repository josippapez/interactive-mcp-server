/**
 * Utility-process entry point for the extracted backend.
 *
 * Phase 2 wires the event-stream pump, SSE session handlers, and context
 * tracking into the utility process. Main drives lifecycle via the bridge
 * (`start-event-stream` / `stop-event-stream` RPCs) and pushes settings
 * snapshots so the pump sees `allowedPermissions`, `allowedReadFolders`,
 * and `autoRegisterSubagents` without re-reading `electron-store`.
 *
 * Lifecycle
 * ---------
 *   1. Electron main calls `utilityProcess.fork(<this file>)` + postMessage
 *      with an init envelope containing `{ port, logsDir, settings }`.
 *   2. We grab the port, init the file logger, build a `Bridge`, register
 *      handlers, and install the main-side RPC accessor.
 *   3. We emit a `ready` event over the bridge so main can race
 *      ready-vs-terminated on startup (pattern #2 from the plan's §11).
 *
 * Later phases will extend this file by wiring the OpenCode server, MCP
 * Express server, DB, etc. The bridge handler/event surface grows in place.
 *
 * NOT imported from the main-process bundle — this is a SEPARATE rollup
 * entry (see electron.vite.config.ts). Must not reach into Electron APIs
 * that are main-only (`app`, `BrowserWindow`, etc).
 */

import { Bridge } from './bridge';
import { initLogger, createLogger } from '../utils/logger';
import { setMainRpc } from './backend/rpc';
import {
  updateSettingsSnapshot,
  type BackendSettingsSnapshot,
} from './backend/settings-mirror';
import {
  startEventStream,
  stopEventStream,
  type StartEventStreamOptions,
} from './backend/event-stream';
import {
  fetchSessionTokens,
  setModelContextLimit,
  setSessionTotalTokens,
  triggerCompaction,
} from './backend/context-tracking';
import { initDatabase } from './backend/database';
import { registerDbRpcHandlers } from './backend/db-rpc';
import { registerSessionRpcHandlers } from './backend/session-rpc';
import { registerOpencodeServerRpcHandlers } from './backend/opencode-server-rpc';
import { registerOpencodeRpcHandlers } from './backend/opencode-rpc';
import {
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  softRestartMcpServer,
  closeSessionByConnectionId,
  getActiveMcpSessionCount,
} from './backend/mcp-server';
import { markSessionDeleted } from './backend/tools/connection-guard';

// Electron utility processes expose `process.parentPort` to receive messages
// and MessagePortMain instances from the parent. Node's own type defs do not
// include this, so we narrow to the subset we use.
interface ParentPortLike {
  once(event: 'message', listener: (e: ParentMessageEvent) => void): void;
}

interface ParentMessageEvent {
  data: unknown;
  // MessagePortMain instances arrive via `ports` on Electron utility process
  // messages, matching the Web MessagePort API.
  ports: unknown[];
}

// Init message sent by main as the very first postMessage after fork.
interface InitMessage {
  kind: 'init';
  /** Platform-specific log directory (= `app.getPath('logs')`). */
  logsDir?: string;
  /** User data directory (= `app.getPath('userData')`). Required for DB path. */
  userDataPath?: string;
  /** Initial settings snapshot — same fields pushed later via `settings-updated`. */
  settings?: Partial<BackendSettingsSnapshot>;
  // Additional config will land here in later phases (dbPath, mcp port, ...).
  // Keep loose-typed for forward-compat.
  [key: string]: unknown;
}

function isInitMessage(v: unknown): v is InitMessage {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as { kind?: unknown }).kind === 'init'
  );
}

function getParentPort(): ParentPortLike {
  const pp = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  if (!pp) {
    throw new Error(
      '[utility] process.parentPort missing — was this entry launched via utilityProcess.fork?',
    );
  }
  return pp;
}

function bootstrap(): void {
  const parentPort = getParentPort();

  parentPort.once('message', (e) => {
    if (!isInitMessage(e.data)) {
      console.error('[utility] first message was not an init envelope', e.data);
      process.exit(1);
    }

    const [port] = e.ports;
    if (!port) {
      console.error('[utility] init message missing transferred port');
      process.exit(1);
    }

    // Init the file logger BEFORE any module-level `createLogger` calls
    // actually emit. Modules imported at the top capture a Logger factory
    // but don't write until their first call — which is always after
    // bootstrap completes.
    if (typeof e.data.logsDir === 'string' && e.data.logsDir.length > 0) {
      try {
        initLogger(e.data.logsDir);
      } catch (err) {
        console.error('[utility] initLogger failed:', err);
      }
    }

    // Seed settings mirror from the initial snapshot.
    if (e.data.settings && typeof e.data.settings === 'object') {
      updateSettingsSnapshot(e.data.settings);
    }

    // userDataPath lives on the settings snapshot for uniformity so the
    // opencode-server module can read it via getSettingsSnapshot().
    const userDataPath =
      typeof e.data.userDataPath === 'string' ? e.data.userDataPath : '';
    if (userDataPath.length === 0) {
      console.error('[utility] init envelope missing userDataPath');
      process.exit(1);
    }
    updateSettingsSnapshot({ userDataPath });

    const log = createLogger('utility-entry');

    // Initialise the SQLite database before any RPC handler that touches it
    // can be invoked. `userDataPath` was seeded onto the settings snapshot
    // above; `initDatabase` is async for API compatibility but performs only
    // sync work internally (better-sqlite3). Fire-and-forget is safe; downstream
    // DB calls block on `db` which is assigned synchronously.
    void initDatabase(userDataPath).catch((err) => {
      console.error('[utility] initDatabase failed:', err);
    });

    // The MessagePortMain surface matches our PortLike contract:
    // postMessage, on('message'), on('close'), start, close.
    const bridge = new Bridge(port as never, {
      tag: 'utility',
      defaultRequestTimeoutMs: 15_000,
    });

    // Publish the bridge to backend modules that need to reach main services
    // (DB lookups, session-tree invalidation, to-renderer forwarding).
    setMainRpc(bridge);

    // Register DB RPC handlers so main-side callers (via db-client) can reach
    // the single DB owner here.
    registerDbRpcHandlers(bridge);

    // Register session RPC handlers (resolver, auto-register, tree service,
    // reconcile). Main-side proxies live in utility/session-client.ts.
    registerSessionRpcHandlers(bridge);

    // Register in-process OpenCode server RPC handlers. Main-side proxies
    // live in utility/opencode-server-client.ts.
    registerOpencodeServerRpcHandlers(bridge);

    // Register the OpenCode SDK-layer RPC handlers (session, injector,
    // providers, MCP, config, agents, etc.). Main-side proxies live in
    // `utility/opencode-client.ts`.
    registerOpencodeRpcHandlers(bridge);

    // MCP server lifecycle. Main drives start/stop/restart via thin proxies
    // in `utility/mcp-server-client.ts`. The Express listener lives here.
    bridge.handle('mcp.server.start', async () => {
      await startMcpServer();
      return { ok: true };
    });
    bridge.handle('mcp.server.stop', () => {
      stopMcpServer();
      return { ok: true };
    });
    bridge.handle('mcp.server.softRestart', async () => {
      const cleared = await softRestartMcpServer();
      return { cleared };
    });
    bridge.handle('mcp.server.restart', async () => {
      await restartMcpServer();
      return { ok: true };
    });
    bridge.handle('mcp.server.closeSessionByConnectionId', async (payload) => {
      const p = payload as { connectionId?: string } | undefined;
      if (!p?.connectionId) return { closed: false };
      const closed = await closeSessionByConnectionId(p.connectionId);
      return { closed };
    });
    bridge.handle('mcp.server.activeSessionCount', () => {
      return { count: getActiveMcpSessionCount() };
    });
    bridge.on('mcp.server.markSessionDeleted', (payload) => {
      const p = payload as { providerSessionId?: string } | undefined;
      if (p?.providerSessionId) markSessionDeleted(p.providerSessionId);
    });

    // ── RPC handlers ────────────────────────────────────────────────────
    // Trivial ping retained from Phase 1 for transport smoke-tests.
    bridge.handle('ping', (payload) => {
      return { ok: true, echo: payload, at: Date.now() };
    });

    // Event-stream lifecycle. Main calls `start-event-stream` once OpenCode
    // is healthy and `stop-event-stream` on app quit.
    bridge.handle('start-event-stream', (payload) => {
      const p = payload as
        | {
            openCodePort?: number;
            logsDir?: string;
            settings?: Partial<BackendSettingsSnapshot>;
          }
        | undefined;

      // Init logger / seed settings if main provided them with the call.
      if (p?.logsDir && typeof p.logsDir === 'string') {
        try {
          initLogger(p.logsDir);
        } catch (err) {
          log.warn(`initLogger failed: ${String(err)}`);
        }
      }
      if (p?.settings && typeof p.settings === 'object') {
        updateSettingsSnapshot(p.settings);
      }

      const openCodePort = p?.openCodePort;
      if (typeof openCodePort !== 'number' || openCodePort <= 0) {
        return {
          ok: false,
          error: 'start-event-stream requires a positive openCodePort',
        };
      }

      const opts: StartEventStreamOptions = {
        getPort: () => openCodePort,
      };
      startEventStream(opts);
      log.info(`event-stream started on port=${openCodePort}`);
      return { ok: true };
    });

    bridge.handle('stop-event-stream', () => {
      stopEventStream();
      log.info('event-stream stopped');
      return { ok: true };
    });

    // Context-tracking RPCs. Main's IPC handlers forward renderer requests
    // to the utility so the session/token state lives in one place.
    bridge.handle('get-context-usage', async (payload) => {
      const p = payload as
        | { sessionId?: string; openCodePort?: number }
        | undefined;
      const sessionId = p?.sessionId;
      const port = p?.openCodePort;
      if (!sessionId || typeof port !== 'number') return null;

      const sessionInfo = await fetchSessionTokens(sessionId, port);
      if (!sessionInfo) return null;

      return setSessionTotalTokens(
        sessionId,
        sessionInfo.tokens ?? 0,
        sessionInfo.modelId,
        sessionInfo.providerId,
      );
    });

    bridge.handle('fetch-session-tokens', async (payload) => {
      const p = payload as
        | { sessionId?: string; openCodePort?: number }
        | undefined;
      if (!p?.sessionId || typeof p.openCodePort !== 'number') return null;
      return fetchSessionTokens(p.sessionId, p.openCodePort);
    });

    bridge.handle('trigger-compaction', async (payload) => {
      const p = payload as
        | {
            sessionId?: string;
            openCodePort?: number;
            providerId?: string;
            modelId?: string;
          }
        | undefined;
      if (!p?.sessionId || typeof p.openCodePort !== 'number') {
        return {
          ok: false,
          error: 'trigger-compaction requires sessionId and openCodePort',
        };
      }
      return triggerCompaction(p.sessionId, p.openCodePort, {
        providerId: p.providerId,
        modelId: p.modelId,
      });
    });

    // Permission reply — renderer → main IPC handler → bridge.request →
    // utility executes replyToOpenCodePermission. See session-tree-handlers.
    bridge.handle('reply-permission', async (payload) => {
      const p = payload as
        | {
            openCodePort?: number;
            sessionID?: string;
            requestID?: string;
            reply?: 'once' | 'always' | 'reject';
            directory?: string;
          }
        | undefined;
      if (!p?.openCodePort || !p.sessionID || !p.requestID || !p.reply) {
        return { ok: false, error: 'reply-permission missing required fields' };
      }
      const { replyToOpenCodePermission } =
        await import('./backend/permission-reply');
      return replyToOpenCodePermission(
        p.openCodePort,
        p.sessionID,
        p.requestID,
        p.reply,
        p.directory,
      );
    });

    // ── Event listeners ────────────────────────────────────────────────
    // Main pushes settings snapshot updates (allowedPermissions, etc).
    bridge.on('settings-updated', (payload) => {
      if (payload && typeof payload === 'object') {
        updateSettingsSnapshot(payload as Partial<BackendSettingsSnapshot>);
      }
    });

    // Main's provider.ts fires this per-model at startup (fire-and-forget).
    bridge.on('set-model-context-limit', (payload) => {
      const p = payload as
        | {
            modelId?: string;
            providerId?: string | null;
            limit?:
              | number
              | {
                  contextWindow: number;
                  inputLimit?: number;
                  outputLimit?: number;
                };
          }
        | undefined;
      if (!p?.modelId || p.limit === undefined) return;
      setModelContextLimit(p.modelId, p.limit, p.providerId ?? undefined);
    });

    // Signal ready. Main uses this to race ready-vs-exit on startup.
    bridge.emit('ready', { at: Date.now(), pid: process.pid });
  });
}

try {
  bootstrap();
} catch (err) {
  console.error('[utility] bootstrap failed:', err);
  process.exit(1);
}
