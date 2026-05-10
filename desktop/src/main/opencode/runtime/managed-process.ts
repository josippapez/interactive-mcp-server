/**
 * managed-process.ts — Process Supervisor pattern.
 *
 * Lifecycle wrapper for any out-of-process OpenCode runtime (Mode B forked
 * utility today, Mode C native binary tomorrow). A `ProcessStrategy` knows
 * how to spawn a particular kind of child and how to wire its native exit
 * and log streams into a `SpawnedHandle`. The supervisor handles the
 * common bits: optional HTTP health probing before resolving start(),
 * graceful stop with a timeout, force-kill fallback, idempotent stop, and
 * subscriber fan-out for exit + log events.
 *
 * This module is transport-agnostic by design — it imports neither
 * `electron` nor `node:child_process`. That keeps the supervisor reusable
 * across modes and trivially unit-testable with a fake strategy.
 *
 * The one in-package dep is `auth-header`, used by the readiness probe
 * to attach Mode C Basic auth on every retry. It's a pure helper that
 * reads from the shared password source and returns `null` in Mode A,
 * so it doesn't compromise the transport-agnostic property.
 */

import { buildOpenCodeBasicAuthHeader } from '../auth-header';

export interface ManagedProcess {
  start(): Promise<{ url: string; password?: string }>;
  stop(timeoutMs?: number): Promise<void>;
  getPid(): number | null;
  onExit(
    cb: (info: { code: number | null; signal: string | null }) => void,
  ): () => void;
  onLog(cb: (line: string) => void): () => void;
}

export interface ProcessStrategy {
  /**
   * Strategy starts the underlying process and resolves once it's alive
   * AND advertising its URL (via whatever mechanism the strategy uses —
   * bridge ready event, stderr parse, etc).
   */
  spawn(args: {
    port: number;
    userDataPath: string;
    logsDir?: string;
  }): Promise<SpawnedHandle>;
}

export interface SpawnedHandle {
  url: string;
  /**
   * HTTP Basic auth password generated for this spawn (Mode C only).
   * Username is always `opencode`. Strategies that don't secure the
   * server (Mode A in-process, dev sidecar without password) leave this
   * undefined — SDK consumers omit the Authorization header in that case.
   */
  password?: string;
  getPid(): number | null;
  /** Subscribe to native exit events. Returns unsubscribe. */
  onExit(
    cb: (info: { code: number | null; signal: string | null }) => void,
  ): () => void;
  /**
   * Subscribe to log lines. Returns unsubscribe. May be a no-op for
   * strategies that don't capture logs.
   */
  onLog(cb: (line: string) => void): () => void;
  /** Send graceful stop signal. Strategy-specific. */
  requestStop(): void;
  /** Force terminate. Strategy-specific. */
  forceKill(): void;
}

export interface CreateManagedProcessOptions {
  port: number;
  userDataPath: string;
  logsDir?: string;
  /**
   * Probe URL for HTTP /health (or any endpoint that returns 2xx when
   * ready). If omitted, supervisor skips HTTP probing and trusts the
   * strategy's spawn() resolution.
   */
  healthProbe?: {
    pathSuffix: string; // e.g. '/health' or '/' — appended to base url from spawn
    intervalMs?: number; // default 200
    timeoutMs?: number; // default 15_000
  };
  /** Tag for log prefixing. Default 'managed-process'. */
  tag?: string;
}

type ExitInfo = { code: number | null; signal: string | null };
type ExitListener = (info: ExitInfo) => void;
type LogListener = (line: string) => void;

const DEFAULT_PROBE_INTERVAL_MS = 200;
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const FORCE_KILL_GRACE_MS = 2_000;

export function createManagedProcess(
  strategy: ProcessStrategy,
  opts: CreateManagedProcessOptions,
): ManagedProcess {
  const tag = opts.tag ?? 'managed-process';

  // External subscribers (live across start/stop cycles).
  const exitListeners = new Set<ExitListener>();
  const logListeners = new Set<LogListener>();

  // Per-spawn state. Reset on each start.
  let handle: SpawnedHandle | null = null;
  let detachHandleExit: (() => void) | null = null;
  let detachHandleLog: (() => void) | null = null;
  let exited = false;
  let lastExitInfo: ExitInfo | null = null;

  // Concurrency guards.
  let starting = false;
  let stopping: Promise<void> | null = null;

  function logErr(message: string, err: unknown): void {
    console.error(
      `[${tag}] ${message}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  function fanOutExit(info: ExitInfo): void {
    for (const cb of [...exitListeners]) {
      try {
        cb(info);
      } catch (err) {
        logErr('exit listener threw', err);
      }
    }
  }

  function fanOutLog(line: string): void {
    for (const cb of [...logListeners]) {
      try {
        cb(line);
      } catch (err) {
        logErr('log listener threw', err);
      }
    }
  }

  function resetSpawnState(): void {
    if (detachHandleExit) {
      try {
        detachHandleExit();
      } catch (err) {
        logErr('detach exit failed', err);
      }
      detachHandleExit = null;
    }
    if (detachHandleLog) {
      try {
        detachHandleLog();
      } catch (err) {
        logErr('detach log failed', err);
      }
      detachHandleLog = null;
    }
    handle = null;
    exited = false;
    lastExitInfo = null;
  }

  async function probeOnce(url: string): Promise<boolean> {
    try {
      // Mode C: the binary requires Basic auth on every endpoint, including
      // health probes. Read the password lazily — it is published into the
      // shared password source by the strategy at spawn time.
      const auth = buildOpenCodeBasicAuthHeader();
      const headers: Record<string, string> = {};
      if (auth) headers.Authorization = auth;
      const res = await fetch(url, { method: 'GET', headers });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async function runHealthProbe(
    targetUrl: string,
    intervalMs: number,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        detachExit();
        resolve();
      };

      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        detachExit();
        reject(err);
      };

      const onExitDuringProbe: ExitListener = (info) => {
        settleReject(
          new Error(
            `Process exited before health probe succeeded (code=${info.code}, signal=${info.signal})`,
          ),
        );
      };

      const detachExit = () => {
        const idx = probeExitListeners.indexOf(onExitDuringProbe);
        if (idx >= 0) probeExitListeners.splice(idx, 1);
      };

      probeExitListeners.push(onExitDuringProbe);

      // If the process already exited before the probe loop started.
      if (exited && lastExitInfo) {
        onExitDuringProbe(lastExitInfo);
        return;
      }

      const tick = async () => {
        if (settled) return;
        const ok = await probeOnce(targetUrl);
        if (settled) return;
        if (ok) {
          settleResolve();
          return;
        }
        if (Date.now() >= deadline) {
          settleReject(
            new Error(
              `Health probe at ${targetUrl} did not return 2xx within ${timeoutMs}ms`,
            ),
          );
          return;
        }
        timer = setTimeout(() => {
          void tick();
        }, intervalMs);
      };

      void tick();
    });
  }

  // Internal exit-listener fan-out used by health probe.
  const probeExitListeners: ExitListener[] = [];

  async function start(): Promise<{ url: string; password?: string }> {
    if (starting || handle) {
      throw new Error(`[${tag}] start() called while already running`);
    }
    starting = true;
    try {
      const spawned = await strategy.spawn({
        port: opts.port,
        userDataPath: opts.userDataPath,
        logsDir: opts.logsDir,
      });
      handle = spawned;

      detachHandleExit = spawned.onExit((info) => {
        exited = true;
        lastExitInfo = info;
        // Fire probe-internal listeners first so an in-flight probe can
        // reject promptly.
        for (const cb of [...probeExitListeners]) {
          try {
            cb(info);
          } catch (err) {
            logErr('probe exit listener threw', err);
          }
        }
        // External subscribers.
        fanOutExit(info);
      });

      detachHandleLog = spawned.onLog((line) => {
        fanOutLog(line);
      });

      if (opts.healthProbe) {
        const probe = opts.healthProbe;
        const intervalMs = probe.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
        const timeoutMs = probe.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
        const targetUrl = `${spawned.url}${probe.pathSuffix}`;
        try {
          await runHealthProbe(targetUrl, intervalMs, timeoutMs);
        } catch (err) {
          // Probe failed — force-kill if process is still up, then
          // unwind state and rethrow.
          if (!exited) {
            try {
              spawned.forceKill();
            } catch (killErr) {
              logErr('forceKill during failed probe threw', killErr);
            }
          }
          resetSpawnState();
          throw err;
        }
      }

      return { url: spawned.url, password: spawned.password };
    } finally {
      starting = false;
    }
  }

  async function waitForExit(timeoutMs: number): Promise<boolean> {
    if (exited) return true;
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = onExit(() => {
        if (timer) clearTimeout(timer);
        resolve(true);
      });
      timer = setTimeout(() => {
        off();
        resolve(false);
      }, timeoutMs);
    });
  }

  async function stop(timeoutMs?: number): Promise<void> {
    if (!handle) {
      return;
    }
    if (stopping) {
      return stopping;
    }
    const localHandle = handle;
    const stopBudget = timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

    stopping = (async () => {
      try {
        if (!exited) {
          try {
            localHandle.requestStop();
          } catch (err) {
            logErr('requestStop threw', err);
          }
        }
        const stoppedGracefully = await waitForExit(stopBudget);
        if (!stoppedGracefully && !exited) {
          try {
            localHandle.forceKill();
          } catch (err) {
            logErr('forceKill threw', err);
          }
          await waitForExit(FORCE_KILL_GRACE_MS);
        }
      } catch (err) {
        logErr('stop() encountered an error', err);
      } finally {
        resetSpawnState();
      }
    })();

    try {
      await stopping;
    } finally {
      stopping = null;
    }
  }

  function getPid(): number | null {
    if (!handle) return null;
    try {
      return handle.getPid();
    } catch {
      return null;
    }
  }

  function onExit(cb: ExitListener): () => void {
    exitListeners.add(cb);
    return () => {
      exitListeners.delete(cb);
    };
  }

  function onLog(cb: LogListener): () => void {
    logListeners.add(cb);
    return () => {
      logListeners.delete(cb);
    };
  }

  return { start, stop, getPid, onExit, onLog };
}
