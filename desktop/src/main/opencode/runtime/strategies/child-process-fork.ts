/**
 * Child-process-fork process strategy (Mode B').
 *
 * # What this is
 *
 * Spawns the same `opencode-host.thread.mjs` JS bundle as Mode B, but via
 * Node's `child_process.fork()` instead of Electron's `utilityProcess.fork()`.
 * The child runs in a regular Node process — it does NOT inherit Electron's
 * per-utility-process network sandbox, which on macOS empirically blocks
 * cross-process loopback HTTP after ~30 seconds (see Mode B restart-loop
 * investigation).
 *
 * # Why this exists
 *
 * Mode B (utilityProcess) validated the topology — the Strategy / Supervisor
 * / Adapter / Selector / Facade composition all work correctly. But the
 * underlying `utilityProcess.fork()` transport produced unstable HTTP
 * serving on macOS. This strategy substitutes the transport while keeping
 * everything else identical.
 *
 * # Relationship to Mode C
 *
 * Mode B' uses `child_process.fork(jsEntry)`. Mode C will use
 * `child_process.spawn(nativeBinary)`. Both are regular OS child processes
 * with the same sandbox/network properties — meaning if Mode B' is stable,
 * Mode C's process model is also stable. So Mode B' validates Mode C's
 * runtime behaviour without requiring the binary build pipeline.
 *
 * # Wire format
 *
 * Init envelope (raw IPC, sent via `child.send()`):
 *   { kind: 'init', userDataPath, logsDir? }
 *
 * Subsequent messages flow through a `Bridge` over a `NodeIpcPortShim`.
 * The host entry's `bootstrapNodeIpc()` consumes init via
 * `process.once('message')` then constructs its Bridge — these are
 * temporally separated, so the init and Bridge listeners never overlap.
 *
 * # Build note
 *
 * Lives at `src/main/opencode/runtime/strategies/child-process-fork.ts`,
 * but is bundled into `out/main/index.mjs`. The host entry is built as
 * `out/main/opencode-host.thread.mjs`. At runtime `__dirname === out/main/`,
 * so joining `OPENCODE_HOST_ENTRY_FILENAME` resolves correctly.
 */

import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { Bridge } from '../../../utility/bridge';
import { writePidfile, clearPidfile } from '../port-resolver';
import {
  RPC_START,
  RPC_STOP,
  type OpencodeHostInitMessage,
  type StartArgs,
  type StartResult,
  type StopResult,
} from '../host-protocol';
import { createParentSidePort } from '../node-ipc-port-shim';
import type { ProcessStrategy, SpawnedHandle } from '../managed-process';

const OPENCODE_HOST_ENTRY_FILENAME = 'opencode-host.thread.mjs';
const READY_TIMEOUT_MS = 10_000;
const STOP_RPC_TIMEOUT_MS = 2_000;
const LOG_PREFIX = '[child-process-fork-strategy]';

type SpawnArgs = Parameters<ProcessStrategy['spawn']>[0];

/**
 * Set of currently-live host PIDs we forked. The parent-death hook below
 * SIGKILLs every entry in this set on `process.exit` / SIGTERM / SIGINT so
 * host children never outlive the Electron main process. Children remove
 * themselves on `exit`. `child_process.fork` does NOT auto-kill the child
 * when the parent dies abruptly (Ctrl+C, hot-reload, crash) — without this,
 * orphaned hosts get reparented to launchd (PPID=1) and keep holding the
 * LISTEN socket on the configured port.
 */
const liveHostPids = new Set<number>();
let parentDeathHookInstalled = false;

function installParentDeathHook(): void {
  if (parentDeathHookInstalled) return;
  parentDeathHookInstalled = true;

  const killAll = (reason: string): void => {
    if (liveHostPids.size === 0) return;
    console.info(
      `${LOG_PREFIX} parent-death hook: SIGKILL ${liveHostPids.size} host child(ren) (reason=${reason})`,
    );
    for (const pid of liveHostPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    liveHostPids.clear();
  };

  // Synchronous: runs as the event loop drains. No async work allowed here.
  process.on('exit', () => killAll('exit'));

  // Forward fatal signals so the child dies first, then re-raise to keep
  // default behaviour (terminate the parent).
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      killAll(sig);
      // Re-raise default behaviour after our cleanup ran.
      process.removeAllListeners(sig);
      process.kill(process.pid, sig);
    });
  }

  // Last-resort: an uncaught exception in main would otherwise leak the
  // child. Log + kill + rethrow via setImmediate so Node still surfaces
  // the original crash with its stack.
  process.on('uncaughtException', (err) => {
    killAll('uncaughtException');
    setImmediate(() => {
      throw err;
    });
  });
}

/**
 * Deprecated. Previously this used `lsof` to SIGKILL any process holding
 * LISTEN on the requested port. That broke dev/prod (and prod/prod) Eden
 * coexistence — each instance murdered the other on startup. Port collision
 * handling now lives in `port-resolver.resolveOpenCodePort`, which probes
 * upward for a free port and only reclaims our own stale children (tracked
 * via pidfile under `userDataPath`).
 *
 * Function removed: see `port-resolver.ts`.
 */

export class ChildProcessForkStrategy implements ProcessStrategy {
  async spawn(args: SpawnArgs): Promise<SpawnedHandle> {
    const { port, userDataPath, logsDir } = args;

    // Install parent-death hook (idempotent) so any host we fork is
    // SIGKILLed if our process dies abruptly. Port collision handling now
    // lives in `port-resolver.resolveOpenCodePort` (called by the host
    // adapter before this strategy spawns).
    installParentDeathHook();

    const entry = join(__dirname, OPENCODE_HOST_ENTRY_FILENAME);
    console.info(`${LOG_PREFIX} forking ${entry}`);

    // `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`:
    //   - stdin: ignored (host doesn't read stdin)
    //   - stdout: piped → fan-out via attachLineReader
    //   - stderr: piped → fan-out via attachLineReader
    //   - ipc: required for `child.send` / `process.send` Node IPC
    //
    // We deliberately do NOT inherit Electron's environment except for the
    // basics; the host is a plain Node process. `execPath` defaults to the
    // current Node binary (Electron's bundled Node when launched from
    // Electron main, regular Node when launched from CLI).
    const child = fork(entry, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      // Force a real Node interpreter rather than reusing Electron's main
      // process binary. When this code runs inside Electron main,
      // `process.execPath` points at the Electron framework binary which
      // would re-launch the entire Electron app instead of starting Node.
      // `ELECTRON_RUN_AS_NODE=1` makes Electron behave as plain Node when
      // re-invoked, which is what we want for the child.
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      // Don't keep this process tied to Electron's stdin (Electron may
      // detach from it on certain quit paths).
      detached: false,
    });

    // 1. Race spawn vs error before postMessage.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (err: unknown): void => {
        child.off('spawn', onSpawn);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    // Track this child's PID for the parent-death hook. Remove on exit so a
    // clean shutdown doesn't leave dead PIDs in the set (PIDs get reused).
    if (typeof child.pid === 'number') {
      liveHostPids.add(child.pid);
      writePidfile(userDataPath, child.pid);
      child.once('exit', () => {
        if (typeof child.pid === 'number') {
          liveHostPids.delete(child.pid);
        }
        clearPidfile(userDataPath);
      });
    }

    // 2. Wire log fan-out BEFORE init so any early stderr (import failures,
    // env-probe issues) is captured.
    const logSubscribers = new Set<(line: string) => void>();
    const emitLine = (line: string): void => {
      if (line.length === 0) return;
      for (const cb of logSubscribers) {
        try {
          cb(line);
        } catch (err) {
          console.warn(`${LOG_PREFIX} log subscriber threw:`, err);
        }
      }
    };
    const stopStdout = attachLineReader(child.stdout, emitLine);
    const stopStderr = attachLineReader(child.stderr, emitLine);

    // 3. Send init envelope as a RAW Node-IPC message (not a Bridge envelope).
    // The child's `bootstrapNodeIpc` consumes it via `process.once('message')`
    // and only THEN constructs its Bridge — so init + Bridge never share a
    // listener.
    const initEnvelope: OpencodeHostInitMessage = {
      kind: 'init',
      userDataPath,
      ...(logsDir ? { logsDir } : {}),
    };
    if (typeof child.send !== 'function') {
      stopStdout();
      stopStderr();
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      throw new Error(
        `${LOG_PREFIX} child has no IPC channel — fork() must be called with stdio including 'ipc'`,
      );
    }
    child.send(initEnvelope);

    // 4. Construct parent-side Bridge AFTER init is sent, so the child has
    // already consumed the raw init message by the time Bridge envelopes
    // start arriving. Timing safety: Node IPC delivers messages in order,
    // and the child registers its Bridge listener before emitting `ready`,
    // so any envelope from the child reaches our Bridge.
    const bridgePort = createParentSidePort(child);
    const bridge = new Bridge(bridgePort as never, {
      tag: 'opencode-host-client',
      defaultRequestTimeoutMs: 15_000,
    });

    // 5. Race ready vs READY_TIMEOUT_MS vs early exit.
    try {
      await waitForReady(child, bridge);
    } catch (err) {
      stopStdout();
      stopStderr();
      try {
        bridge.dispose('ready-timeout-or-exit');
      } catch {
        /* ignore */
      }
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      throw err;
    }

    // 6. Issue start RPC.
    const startArgs: StartArgs = { port };
    let url: string;
    try {
      const result = await bridge.request<StartResult>(RPC_START, startArgs);
      url = result.url;
    } catch (err) {
      stopStdout();
      stopStderr();
      try {
        bridge.dispose('start-rpc-failed');
      } catch {
        /* ignore */
      }
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      throw err;
    }

    // 7. Build SpawnedHandle.
    const handle: SpawnedHandle = {
      url,
      getPid: () => child.pid ?? null,
      onExit: (cb) => {
        const handler = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ): void => {
          cb({ code, signal });
        };
        child.on('exit', handler);
        return () => {
          child.off('exit', handler);
        };
      },
      onLog: (cb) => {
        logSubscribers.add(cb);
        return () => {
          logSubscribers.delete(cb);
        };
      },
      requestStop: () => {
        bridge
          .request<StopResult>(RPC_STOP, {}, { timeoutMs: STOP_RPC_TIMEOUT_MS })
          .catch((err) => {
            console.warn(`${LOG_PREFIX} RPC_STOP failed:`, err);
          });
      },
      forceKill: () => {
        try {
          bridge.dispose('forceKill');
        } catch {
          /* ignore */
        }
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        stopStdout();
        stopStderr();
      },
    };

    // Auto-clean log readers when the child exits.
    child.once('exit', () => {
      stopStdout();
      stopStderr();
    });

    return handle;
  }
}

/**
 * Race the bridge `ready` event vs READY_TIMEOUT_MS vs an early child exit.
 * Resolves on first ready; rejects on either timeout or exit-before-ready.
 */
function waitForReady(child: ChildProcess, bridge: Bridge): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const elapsed = Date.now() - startedAt;
      reject(
        new Error(
          `${LOG_PREFIX} child did not emit 'ready' within ${READY_TIMEOUT_MS}ms (waited ${elapsed}ms)`,
        ),
      );
    }, READY_TIMEOUT_MS);
    timer.unref?.();

    const offReady = bridge.on('ready', (payload) => {
      if (settled) return;
      settled = true;
      console.info(`${LOG_PREFIX} child ready`, payload);
      cleanup();
      resolve();
    });

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `${LOG_PREFIX} child exited before ready (code=${code}, signal=${signal})`,
        ),
      );
    };
    child.once('exit', onExit);

    function cleanup(): void {
      clearTimeout(timer);
      offReady();
      child.off('exit', onExit);
    }
  });
}

/**
 * Subscribe to a Node `Readable` stream and emit one callback per complete
 * `\n`-terminated line. Holds partial lines in a buffer until the next chunk.
 * Returns a disposer that detaches all listeners and flushes any final
 * partial line. Identical contract to the helper in `forked-utility.ts` —
 * duplicated here rather than shared so each strategy stays self-contained.
 */
function attachLineReader(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): () => void {
  if (stream === null) {
    return () => {
      /* noop */
    };
  }

  let buffer = '';
  let detached = false;

  const onData = (chunk: Buffer | string): void => {
    if (detached) return;
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      onLine(line);
      nl = buffer.indexOf('\n');
    }
  };

  const onEnd = (): void => {
    if (detached) return;
    if (buffer.length > 0) {
      onLine(buffer.replace(/\r$/, ''));
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.once('end', onEnd);

  return () => {
    if (detached) return;
    detached = true;
    stream.off('data', onData);
    stream.off('end', onEnd);
    if (buffer.length > 0) {
      try {
        onLine(buffer.replace(/\r$/, ''));
      } catch {
        /* ignore */
      }
      buffer = '';
    }
  };
}
