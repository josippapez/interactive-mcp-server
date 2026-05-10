/**
 * Dedicated `opencode-host` utility-process entry point.
 *
 * Launched by `runtime-dedicated-utility.ts` via:
 *   `utilityProcess.fork('out/main/opencode-host.thread.mjs')`
 *
 * Runs in its OWN Node process for crash isolation — if OpenCode's embedded
 * server crashes (native binding, unhandled rejection in upstream code,
 * etc), only this child dies. The main utility process and the renderer
 * stay healthy and can re-fork the host.
 *
 * Communication
 * -------------
 *   - Init: parent posts a single `{ kind: 'init', userDataPath, logsDir }`
 *     envelope plus a transferred `MessagePortMain`.
 *   - Lifecycle RPCs flow over a `Bridge` built on that port:
 *       opencode-host.start  → boot Server.listen
 *       opencode-host.stop   → tear down listener
 *       opencode-host.status → report running state + url
 *   - We emit a `ready` event once handlers are wired so the parent can
 *     race ready-vs-exit on startup (same pattern as `entry.ts`).
 *
 * Self-contained
 * --------------
 * The shell-env probing + PATH-fallback helpers are inlined (rather than
 * imported from `runtime-in-process.ts`) so this host can later be swapped
 * to a different process model — e.g. a native subprocess with its own
 * IPC transport — without disturbing the in-process runtime path.
 *
 * NOT imported from the main-process bundle. This is a SEPARATE rollup
 * entry (see electron.vite.config.ts). Must not reach into Electron APIs
 * that are main-only (`app`, `BrowserWindow`, etc).
 */

import { Bridge } from '../../bridge';
import { createChildSidePort } from '../../../opencode/runtime/node-ipc-port-shim';
import {
  RPC_START,
  RPC_STATUS,
  RPC_STOP,
  type OpencodeHostInitMessage,
  type StartArgs,
  type StartResult,
  type StatusResult,
  type StopResult,
} from '../../../opencode/runtime/host-protocol';

// ---------------------------------------------------------------------------
// Parent-port narrowing (Electron utility-process surface, not in @types/node)
// ---------------------------------------------------------------------------

interface ParentPortLike {
  once(event: 'message', listener: (e: ParentMessageEvent) => void): void;
}

interface ParentMessageEvent {
  data: unknown;
  ports: unknown[];
}

function isInitMessage(v: unknown): v is OpencodeHostInitMessage {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as { kind?: unknown; userDataPath?: unknown };
  return (
    obj.kind === 'init' &&
    typeof obj.userDataPath === 'string' &&
    obj.userDataPath.length > 0
  );
}

/**
 * Returns Electron's `process.parentPort` if this entry was launched via
 * `utilityProcess.fork()`. Returns null when launched via Node's
 * `child_process.fork()` (in which case `process.send` IS the IPC channel).
 */
function tryGetParentPort(): ParentPortLike | null {
  const pp = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  return pp ?? null;
}

/**
 * Returns true when this entry was launched via Node's `child_process.fork()`
 * with an IPC channel. Mutually exclusive with the Electron-utility transport.
 */
function hasNodeIpc(): boolean {
  return typeof (process as { send?: unknown }).send === 'function';
}

// ---------------------------------------------------------------------------
// Listener state (module-local — single host process owns one listener)
// ---------------------------------------------------------------------------

interface Listener {
  url: string;
  stop: () => Promise<void> | void;
}

let listener: Listener | null = null;
let managedPort: number | null = null;
let startingPromise: Promise<Listener> | null = null;

async function startListener(port: number): Promise<Listener> {
  // Idempotent same-port: return existing.
  if (listener && managedPort === port) {
    return listener;
  }

  // Concurrent callers share the in-flight startup promise so the dynamic
  // import of the 17 MB OpenCode bundle only runs once.
  if (startingPromise) {
    const existing = await startingPromise;
    if (listener && managedPort === port) {
      return existing;
    }
  }

  // Different port requested — tear down previous listener first.
  if (listener) {
    await stopListener();
  }

  startingPromise = (async () => {
    // Dynamic import keeps the bundle out of the host's startup cost when
    // start has not yet been invoked. Parent typically calls start
    // immediately, but other process models may defer.
    const mod = await import('virtual:opencode-server');

    try {
      await mod.Log.init({ level: 'WARN' });
    } catch (err) {
      // Best-effort — Log.init failures must not block listen().
      console.warn(
        `[opencode-host] Log.init failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    console.log(`[opencode-host] Starting Server.listen on 127.0.0.1:${port}`);

    let live: Listener;
    try {
      live = (await mod.Server.listen({
        port,
        hostname: '127.0.0.1',
      })) as Listener;
    } catch (err) {
      // Loud surface for EADDRINUSE / EACCES / etc. — without this, the
      // rejected promise propagates up to the strategy but the host's own
      // logs only show silence between "Starting Server.listen" and exit.
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : 'unknown';
      console.error(
        `[opencode-host] Server.listen FAILED on 127.0.0.1:${port} (code=${code}): ${
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        }`,
      );
      throw err;
    }

    listener = live;
    managedPort = port;

    console.log(`[opencode-host] Ready at ${live.url}`);
    startHeartbeat(live.url);
    return live;
  })();

  try {
    return await startingPromise;
  } finally {
    startingPromise = null;
  }
}

async function stopListener(): Promise<void> {
  if (!listener) return;
  const dying = listener;
  listener = null;
  managedPort = null;
  stopHeartbeat();
  try {
    await dying.stop();
  } catch (err) {
    console.warn(
      `[opencode-host] listener.stop() threw (ignored): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Heartbeat — periodic "still alive" log so we can tell from terminal output
// whether the host process is still running when external HTTP probes start
// failing. Added during the Mode B restart-loop investigation. The interval
// is `unref`d so it never keeps the event loop alive on its own.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 5_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatStartedAt: number | null = null;

function startHeartbeat(url: string): void {
  if (heartbeatTimer) return;
  heartbeatStartedAt = Date.now();
  heartbeatTimer = setInterval(() => {
    if (!heartbeatStartedAt) return;
    const ageS = Math.floor((Date.now() - heartbeatStartedAt) / 1000);
    // Self-probe: does the listener answer on its own URL from inside the
    // same process? If this fails while `listener` is non-null, the
    // OpenCode bundle's listener has died without notifying us.
    void selfProbe(url).then((probe) => {
      console.log(
        `[opencode-host] alive pid=${process.pid} age=${ageS}s url=${url} listener=${listener ? 'open' : 'closed'} self-probe=${probe}`,
      );
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

async function selfProbe(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(2_000),
    });
    return `ok(${res.status})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `fail(${msg})`;
  }
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatStartedAt = null;
}

// ---------------------------------------------------------------------------
// Env preparation
//
// PATH is already patched in the main process at startup via fix-path
// (see desktop/src/main/index.ts). Electron's utilityProcess.fork inherits
// process.env by default, so this host receives the patched PATH and any
// child it spawns (MCP servers via npx) inherits it too.
// ---------------------------------------------------------------------------

function prepareServerEnv(userDataPath: string): void {
  process.env.XDG_STATE_HOME = userDataPath;
  process.env.OPENCODE_CLIENT = 'desktop';
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bootstrap(): void {
  // Capture every reason this process could be terminating. Without these
  // hooks the host can die silently (uncaught throw inside the OpenCode
  // bundle, native crash, OOM, parent SIGTERM) and the only externally
  // visible symptom is `fetch failed` on health probes. These logs reach
  // the strategy via stderr/stdout fan-out → the adapter → console.
  process.on('uncaughtException', (err) => {
    console.error(
      `[opencode-host] uncaughtException: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  });
  process.on('unhandledRejection', (reason) => {
    console.error(
      `[opencode-host] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });
  process.on('exit', (code) => {
    console.log(
      `[opencode-host] process exiting code=${code} pid=${process.pid}`,
    );
  });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      console.log(`[opencode-host] received ${sig} pid=${process.pid}`);
    });
  }

  // Two transports are supported:
  //   1. Electron utility — `process.parentPort` is present; init arrives
  //      via parentPort with a transferred MessagePortMain. Bridge is built
  //      on that port. (Mode B.)
  //   2. Node IPC — `process.send` is present; init arrives via
  //      `process.on('message')` directly, no separate transferred port.
  //      Bridge is built over a NodeIpcPortShim wrapping `process` itself.
  //      (Mode B' and Mode C in the future.)
  const electronPort = tryGetParentPort();
  if (electronPort) {
    bootstrapElectronUtility(electronPort);
    return;
  }

  if (hasNodeIpc()) {
    bootstrapNodeIpc();
    return;
  }

  console.error(
    '[opencode-host] no parent IPC available — neither process.parentPort nor process.send is present. ' +
      'This entry must be launched via utilityProcess.fork() or child_process.fork() with an IPC channel.',
  );
  process.exit(1);
}

function bootstrapElectronUtility(parentPort: ParentPortLike): void {
  parentPort.once('message', (e) => {
    if (!isInitMessage(e.data)) {
      console.error(
        '[opencode-host] first message was not a valid init envelope',
        e.data,
      );
      process.exit(1);
    }

    const [port] = e.ports;
    if (!port) {
      console.error('[opencode-host] init message missing transferred port');
      process.exit(1);
    }

    // Prepare env BEFORE any dynamic import of virtual:opencode-server. The
    // dynamic import happens lazily inside `startListener`, so this only
    // needs to run once at boot.
    prepareServerEnv(e.data.userDataPath);

    const bridge = new Bridge(port as never, {
      tag: 'opencode-host',
      defaultRequestTimeoutMs: 15_000,
    });

    wireBridgeHandlers(bridge);

    // Signal ready. Parent uses this to race ready-vs-exit on startup.
    bridge.emit('ready', { at: Date.now(), pid: process.pid });
  });
}

/**
 * Node-IPC transport (Mode B'). The IPC channel itself carries both the
 * init envelope (raw `process.send`) and Bridge envelopes (after init). The
 * one-shot `process.once('message')` consumes the init message before the
 * Bridge attaches its own listener, so they never overlap.
 */
function bootstrapNodeIpc(): void {
  const onInit = (msg: unknown): void => {
    if (!isInitMessage(msg)) {
      console.error(
        '[opencode-host] first IPC message was not a valid init envelope',
        msg,
      );
      process.exit(1);
    }

    prepareServerEnv(msg.userDataPath);

    // Construct Bridge AFTER consuming init. The shim attaches its own
    // 'message' listener to `process`, which receives only post-init
    // envelopes.
    const port = createChildSidePort();
    const bridge = new Bridge(port as never, {
      tag: 'opencode-host',
      defaultRequestTimeoutMs: 15_000,
    });

    wireBridgeHandlers(bridge);

    // Signal ready over the bridge — parent races this against early exit.
    bridge.emit('ready', { at: Date.now(), pid: process.pid });
  };

  // `once` so the init handler removes itself before Bridge attaches.
  process.once('message', onInit);
}

/**
 * Register lifecycle RPC handlers on a Bridge instance. Used by both
 * transports — the wire shape is identical, only the underlying port
 * differs.
 */
function wireBridgeHandlers(bridge: Bridge): void {
  bridge.handle(RPC_START, async (payload): Promise<StartResult> => {
    const args = payload as StartArgs | undefined;
    if (!args || typeof args.port !== 'number' || args.port <= 0) {
      throw new Error(`[opencode-host] ${RPC_START} requires a positive port`);
    }
    const live = await startListener(args.port);
    return { ok: true, url: live.url };
  });

  bridge.handle(RPC_STOP, async (): Promise<StopResult> => {
    await stopListener();
    return { ok: true };
  });

  bridge.handle(RPC_STATUS, (): StatusResult => {
    return {
      running: listener !== null,
      url: listener?.url ?? null,
    };
  });
}

try {
  bootstrap();
} catch (err) {
  console.error('[opencode-host] bootstrap failed:', err);
  process.exit(1);
}
