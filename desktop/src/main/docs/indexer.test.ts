// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:worker_threads BEFORE importing the module under test so the
// module-level `isMainThread` branch is hit on the main-thread side and the
// worker is never actually spawned.
const terminateSpy = vi.fn(() => Promise.resolve(0));
const workerCtor = vi.fn();

vi.mock('node:worker_threads', () => {
  class MockWorker {
    constructor(...args: unknown[]) {
      workerCtor(...args);
    }
    on() {
      return this;
    }
    postMessage = vi.fn();
    terminate = terminateSpy;
  }
  return {
    Worker: MockWorker,
    isMainThread: true,
    parentPort: null,
  };
});

import { warmUp, shutdown, isReady } from './indexer';

describe('indexer worker lifecycle', () => {
  beforeEach(async () => {
    terminateSpy.mockClear();
    terminateSpy.mockImplementation(() => Promise.resolve(0));
    workerCtor.mockClear();
    // Ensure we start from a clean slate — shutdown is idempotent.
    await shutdown();
  });

  it('shutdown is a no-op when no worker has been warmed up', async () => {
    await expect(shutdown()).resolves.toBeUndefined();
    expect(terminateSpy).not.toHaveBeenCalled();
    expect(isReady()).toBe(false);
  });

  it('shutdown terminates the worker and resets ready state', async () => {
    warmUp();
    expect(workerCtor).toHaveBeenCalledTimes(1);

    await shutdown();

    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(isReady()).toBe(false);
  });

  it('shutdown awaits Worker.terminate() before resolving', async () => {
    let resolveTerminate: ((code: number) => void) | undefined;
    terminateSpy.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveTerminate = resolve;
        }),
    );

    warmUp();
    const shutdownPromise = shutdown();

    // Give the microtask queue a chance to run — shutdown must NOT have
    // resolved yet because terminate is still pending.
    let settled = false;
    shutdownPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveTerminate?.(0);
    await shutdownPromise;
    expect(settled).toBe(true);
  });

  it('shutdown is idempotent — calling it twice only terminates once', async () => {
    warmUp();

    await shutdown();
    await shutdown();

    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });

  it('warmUp after shutdown spawns a fresh worker', async () => {
    warmUp();
    await shutdown();
    warmUp();

    expect(workerCtor).toHaveBeenCalledTimes(2);
    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });
});
