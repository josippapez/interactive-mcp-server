/**
 * managed-process.test.ts
 *
 * Unit tests for the ManagedProcess + ProcessStrategy abstraction. These
 * tests are pure — no Electron, no child_process. The strategy is a fake
 * that lets each test drive spawn resolution, exit events, log lines, and
 * stop semantics.
 *
 * The HTTP probe path uses a stubbed `globalThis.fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createManagedProcess,
  type ProcessStrategy,
  type SpawnedHandle,
} from './managed-process';

type ExitInfo = { code: number | null; signal: string | null };

interface FakeHandleControls {
  /** Manually fire the exit event. */
  fireExit: (info: ExitInfo) => void;
  /** Manually emit a log line. */
  emitLog: (line: string) => void;
  /** Whether requestStop() will trigger an automatic exit (default true). */
  setAutoExitOnStop: (enabled: boolean) => void;
  /** Was requestStop called? */
  requestStopCalled: () => number;
  /** Was forceKill called? */
  forceKillCalled: () => number;
}

interface FakeStrategyOptions {
  /** URL the spawned handle should advertise. Default 'http://127.0.0.1:4096'. */
  url?: string;
  /** Pid the handle should report. Default 12345. */
  pid?: number;
  /** Make spawn() reject with this error instead of resolving. */
  spawnError?: Error;
  /** Delay (ms) before spawn resolves. Default 0. */
  spawnDelayMs?: number;
}

function createFakeStrategy(opts: FakeStrategyOptions = {}): {
  strategy: ProcessStrategy;
  controls: FakeHandleControls;
} {
  const url = opts.url ?? 'http://127.0.0.1:4096';
  let pid: number | null = opts.pid ?? 12345;
  let autoExitOnStop = true;
  let requestStopCount = 0;
  let forceKillCount = 0;

  const exitListeners = new Set<(info: ExitInfo) => void>();
  const logListeners = new Set<(line: string) => void>();

  const fireExit = (info: ExitInfo) => {
    pid = null;
    for (const l of [...exitListeners]) l(info);
  };

  const emitLog = (line: string) => {
    for (const l of [...logListeners]) l(line);
  };

  const handle: SpawnedHandle = {
    url,
    getPid: () => pid,
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
    onLog: (cb) => {
      logListeners.add(cb);
      return () => logListeners.delete(cb);
    },
    requestStop: () => {
      requestStopCount += 1;
      if (autoExitOnStop) {
        // Fire on next microtask to mimic real async exit.
        queueMicrotask(() => fireExit({ code: 0, signal: null }));
      }
    },
    forceKill: () => {
      forceKillCount += 1;
      // forceKill always exits.
      queueMicrotask(() => fireExit({ code: null, signal: 'SIGKILL' }));
    },
  };

  const strategy: ProcessStrategy = {
    spawn: async () => {
      if (opts.spawnDelayMs && opts.spawnDelayMs > 0) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, opts.spawnDelayMs),
        );
      }
      if (opts.spawnError) throw opts.spawnError;
      return handle;
    },
  };

  return {
    strategy,
    controls: {
      fireExit,
      emitLog,
      setAutoExitOnStop: (enabled) => {
        autoExitOnStop = enabled;
      },
      requestStopCalled: () => requestStopCount,
      forceKillCalled: () => forceKillCount,
    },
  };
}

const baseOpts = {
  port: 4096,
  userDataPath: '/tmp/userData',
  logsDir: '/tmp/logs',
};

describe('createManagedProcess', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      // @ts-expect-error - allow deletion in test env
      delete globalThis.fetch;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('start() resolves with { url } when no health probe is configured', async () => {
    const { strategy } = createFakeStrategy({ url: 'http://127.0.0.1:5000' });
    const mp = createManagedProcess(strategy, baseOpts);
    const result = await mp.start();
    expect(result).toEqual({ url: 'http://127.0.0.1:5000' });
    expect(mp.getPid()).toBe(12345);
  });

  it('start() resolves only after HTTP probe succeeds with 2xx', async () => {
    const { strategy } = createFakeStrategy();

    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        // First two calls fail with connection refused.
        throw new Error('ECONNREFUSED');
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const mp = createManagedProcess(strategy, {
      ...baseOpts,
      healthProbe: { pathSuffix: '/health', intervalMs: 5, timeoutMs: 2000 },
    });

    const result = await mp.start();
    expect(result.url).toBe('http://127.0.0.1:4096');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('start() rejects with timeout error when probe never succeeds', async () => {
    const { strategy, controls } = createFakeStrategy();

    globalThis.fetch = vi.fn(async () => {
      return new Response('nope', { status: 503 });
    }) as unknown as typeof fetch;

    const mp = createManagedProcess(strategy, {
      ...baseOpts,
      healthProbe: { pathSuffix: '/health', intervalMs: 5, timeoutMs: 60 },
    });

    await expect(mp.start()).rejects.toThrow(/health probe/i);
    // On timeout, supervisor must force-kill the process.
    expect(controls.forceKillCalled()).toBeGreaterThanOrEqual(1);
  });

  it('start() rejects when process exits during probe', async () => {
    const { strategy, controls } = createFakeStrategy();

    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const mp = createManagedProcess(strategy, {
      ...baseOpts,
      healthProbe: { pathSuffix: '/health', intervalMs: 5, timeoutMs: 5000 },
    });

    const startPromise = mp.start();
    // Fire an early exit shortly after start begins.
    setTimeout(() => controls.fireExit({ code: 137, signal: null }), 20);

    await expect(startPromise).rejects.toThrow(
      /exited before health probe succeeded/i,
    );
  });

  it('start() rejects when called twice without stop()', async () => {
    const { strategy } = createFakeStrategy();
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();
    await expect(mp.start()).rejects.toThrow(/already running/i);
  });

  it('stop() is idempotent', async () => {
    const { strategy } = createFakeStrategy();
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();

    await mp.stop();
    // Second call must not throw.
    await mp.stop();
    await mp.stop();
  });

  it('stop() calls requestStop first, then forceKill if timeout elapses', async () => {
    const { strategy, controls } = createFakeStrategy();
    controls.setAutoExitOnStop(false); // hang on requestStop
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();

    await mp.stop(50); // small timeout to trigger forceKill path

    expect(controls.requestStopCalled()).toBe(1);
    expect(controls.forceKillCalled()).toBeGreaterThanOrEqual(1);
  });

  it('onExit subscribers fire when the process exits', async () => {
    const { strategy, controls } = createFakeStrategy();
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();

    const exitCb = vi.fn();
    mp.onExit(exitCb);

    controls.fireExit({ code: 0, signal: null });
    expect(exitCb).toHaveBeenCalledWith({ code: 0, signal: null });
  });

  it('onLog subscribers receive lines from the strategy', async () => {
    const { strategy, controls } = createFakeStrategy();
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();

    const logCb = vi.fn();
    const unsub = mp.onLog(logCb);

    controls.emitLog('hello');
    controls.emitLog('world');
    expect(logCb).toHaveBeenCalledWith('hello');
    expect(logCb).toHaveBeenCalledWith('world');

    unsub();
    controls.emitLog('after-unsub');
    expect(logCb).toHaveBeenCalledTimes(2);
  });

  it('getPid() returns pid while running, null after stop', async () => {
    const { strategy } = createFakeStrategy({ pid: 99 });
    const mp = createManagedProcess(strategy, baseOpts);
    expect(mp.getPid()).toBeNull();

    await mp.start();
    expect(mp.getPid()).toBe(99);

    await mp.stop();
    expect(mp.getPid()).toBeNull();
  });

  it('multiple onExit subscribers all fire', async () => {
    const { strategy, controls } = createFakeStrategy();
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();

    const a = vi.fn();
    const b = vi.fn();
    mp.onExit(a);
    mp.onExit(b);

    controls.fireExit({ code: 1, signal: null });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('start() rejects when strategy.spawn() throws', async () => {
    const { strategy } = createFakeStrategy({
      spawnError: new Error('spawn failed: ENOENT'),
    });
    const mp = createManagedProcess(strategy, baseOpts);
    await expect(mp.start()).rejects.toThrow(/spawn failed/);
    expect(mp.getPid()).toBeNull();
  });

  it('start() can be called again after stop()', async () => {
    const { strategy } = createFakeStrategy();
    const mp = createManagedProcess(strategy, baseOpts);
    await mp.start();
    await mp.stop();

    // After clean stop, start should work again.
    const result = await mp.start();
    expect(result.url).toBe('http://127.0.0.1:4096');
  });

  it('health probe uses the configured pathSuffix on the spawned URL', async () => {
    const { strategy } = createFakeStrategy({
      url: 'http://127.0.0.1:7777',
    });

    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input.toString();
      seen.push(u);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const mp = createManagedProcess(strategy, {
      ...baseOpts,
      healthProbe: { pathSuffix: '/health', intervalMs: 5, timeoutMs: 2000 },
    });
    await mp.start();
    expect(seen[0]).toBe('http://127.0.0.1:7777/health');
  });
});
