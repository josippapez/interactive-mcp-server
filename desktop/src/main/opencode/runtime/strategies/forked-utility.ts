/**
 * Forked-utility process strategy (Mode B).
 *
 * Spawns the `opencode-host` utility process via `utilityProcess.fork()` and
 * exposes it as a {@link ProcessStrategy} so {@link createManagedProcess} owns
 * the lifecycle (health probing, restarts, logging fan-out). This file is
 * deliberately a thin spawn primitive — settings reads, retries, and crash
 * supervision live one layer up.
 *
 * Build note: after the Stage 1 source moves, this file lives at
 * `src/main/opencode/runtime/strategies/forked-utility.ts`, but it is bundled
 * into `out/main/index.mjs` together with the rest of the main process. The
 * host entry (`src/main/utility/backend/opencode/opencode-host-entry.ts`) is
 * built as a separate chunk to `out/main/opencode-host.thread.mjs`. So at
 * runtime `__dirname === out/main/` regardless of source layout, and joining
 * `OPENCODE_HOST_ENTRY_FILENAME` resolves correctly.
 */

import { MessageChannelMain, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';
import { Bridge } from '../../../utility/bridge';
import {
  RPC_START,
  RPC_STOP,
  type OpencodeHostInitMessage,
  type StartArgs,
  type StartResult,
  type StopResult,
} from '../host-protocol';

// TODO Stage 6 merge: import from './managed-process' once Stage 2 lands.
// These mirror the contract Subagent B is producing in
// `src/main/opencode/runtime/managed-process.ts`. Keep field names aligned.
export interface SpawnArgs {
  port: number;
  userDataPath: string;
  logsDir?: string;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SpawnedHandle {
  url: string;
  getPid: () => number | null;
  onExit: (cb: (info: ExitInfo) => void) => () => void;
  onLog: (cb: (line: string) => void) => () => void;
  requestStop: () => void;
  forceKill: () => void;
}

export interface ProcessStrategy {
  spawn(args: SpawnArgs): Promise<SpawnedHandle>;
}
// END placeholder block.

const OPENCODE_HOST_ENTRY_FILENAME = 'opencode-host.thread.mjs';
const READY_TIMEOUT_MS = 10_000;
const STOP_RPC_TIMEOUT_MS = 2_000;
const LOG_PREFIX = '[forked-utility-strategy]';

export class ForkedUtilityStrategy implements ProcessStrategy {
  async spawn(args: SpawnArgs): Promise<SpawnedHandle> {
    const { port, userDataPath, logsDir } = args;

    const entry = join(__dirname, OPENCODE_HOST_ENTRY_FILENAME);
    console.info(`${LOG_PREFIX} forking ${entry}`);

    // `stdio: 'pipe'` (vs 'inherit') so we can fan stdout/stderr lines out
    // through `onLog`. The supervisor decides where to forward them.
    const child = utilityProcess.fork(entry, [], {
      serviceName: 'opencode-host',
      stdio: 'pipe',
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

    // 2. Build bridge over MessageChannelMain.
    const { port1, port2 } = new MessageChannelMain();
    const bridge = new Bridge(port1 as never, {
      tag: 'opencode-host-client',
      defaultRequestTimeoutMs: 15_000,
    });

    // 3. Wire up log fan-out. We start collecting before postMessage so any
    // early stderr from the child (e.g. import-time failures) is captured.
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

    // 4. Send init envelope (transferring port2 to the child).
    const initEnvelope: OpencodeHostInitMessage = {
      kind: 'init',
      userDataPath,
      ...(logsDir ? { logsDir } : {}),
    };
    child.postMessage(initEnvelope, [port2]);

    // 5. Race ready vs READY_TIMEOUT_MS vs early exit.
    try {
      await waitForReady(child, bridge);
    } catch (err) {
      // Tear down everything we set up before the failure propagates.
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

    // 7. Build SpawnedHandle. `onExit` and `onLog` may have multiple
    // subscribers; each `on*` returns its own unsubscribe.
    const handle: SpawnedHandle = {
      url,
      getPid: () => child.pid ?? null,
      onExit: (cb) => {
        // utilityProcess emits exit with a numeric code only — no signal is
        // exposed, so we surface `signal: null`.
        const handler = (code: number): void => {
          cb({ code, signal: null });
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
        // Best-effort graceful stop. We intentionally don't await; the
        // supervisor decides when to escalate to `forceKill`.
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
          child.kill();
        } catch {
          /* ignore */
        }
        stopStdout();
        stopStderr();
      },
    };

    // Auto-clean log readers when the child exits, so we don't leak
    // listeners on the (now-closed) stdio streams.
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
 *
 * Note: we wrap `bridge.on('ready', ...)` as a one-shot ourselves — the
 * Bridge does not natively dedupe multi-fire events. If the host re-emits
 * `ready` later (e.g. after an internal restart), the second emission is
 * ignored here.
 */
function waitForReady(child: UtilityProcess, bridge: Bridge): Promise<void> {
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

    const onExit = (code: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(`${LOG_PREFIX} child exited before ready (code=${code})`),
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
 * partial line.
 *
 * `stream` is typed nullable because TS narrows `child.stdout` / `stderr` to
 * `Readable | null` even when `stdio: 'pipe'` is set.
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
    // Flush tail on manual detach too.
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
