/**
 * Tests for the context-injector worker wrapper.
 *
 * We mock the underlying Worker by injecting a fake factory via the
 * `__setWorkerFactoryForTests` seam, so no real worker_threads thread is
 * spawned. This verifies argument serialization, response routing, error
 * handling, and the main-thread fallback path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  __setWorkerFactoryForTests,
  __shutdownWorkerForTests,
  searchDocsInWorker,
  type WorkerLike,
} from './context-injector-worker';
import type { DocSearchResult } from './context-injector';

// --- Fake Worker -----------------------------------------------------------

interface WorkerRequestShape {
  id: number;
  query: string;
  baseDirectory: string;
  limit?: number;
}

interface WorkerResponseShape {
  id: number;
  ok: boolean;
  results?: DocSearchResult[];
  error?: string;
}

interface FakeWorkerOptions {
  /** If set, postMessage will not auto-reply. Tests can drive the reply manually. */
  manual?: boolean;
  /** When set, the fake will emit this error after the first postMessage. */
  errorAfterFirstMessage?: Error;
  /** Customize the reply built from a request. */
  buildReply?: (req: WorkerRequestShape) => WorkerResponseShape;
}

class FakeWorker extends EventEmitter implements WorkerLike {
  public received: WorkerRequestShape[] = [];
  public terminated = false;

  constructor(private opts: FakeWorkerOptions = {}) {
    super();
  }

  postMessage(msg: WorkerRequestShape): void {
    this.received.push(msg);

    if (this.opts.errorAfterFirstMessage) {
      queueMicrotask(() => {
        this.emit('error', this.opts.errorAfterFirstMessage!);
      });
      return;
    }

    if (this.opts.manual) return;

    queueMicrotask(() => {
      const reply: WorkerResponseShape = this.opts.buildReply
        ? this.opts.buildReply(msg)
        : {
            id: msg.id,
            ok: true,
            results: [{ path: 'OK.md', score: 1, lineNumber: 1, snippet: '' }],
          };
      this.emit('message', reply);
    });
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    this.emit('exit', 0);
    return 0;
  }
}

afterEach(async () => {
  await __shutdownWorkerForTests();
  __setWorkerFactoryForTests(null);
  vi.restoreAllMocks();
});

// --- Tests -----------------------------------------------------------------

describe('searchDocsInWorker', () => {
  it('serializes args to the worker and returns the worker reply', async () => {
    let captured: WorkerRequestShape | null = null;
    const fake = new FakeWorker({
      buildReply: (req) => {
        captured = req;
        return {
          id: req.id,
          ok: true,
          results: [
            {
              path: 'docs/x.md',
              score: 5,
              lineNumber: 3,
              snippet: 'hello',
            },
          ],
        };
      },
    });
    __setWorkerFactoryForTests(() => fake);

    const out = await searchDocsInWorker('hello world', '/repo', 4);

    expect(captured).toMatchObject({
      query: 'hello world',
      baseDirectory: '/repo',
      limit: 4,
    });
    expect(typeof captured!.id).toBe('number');
    expect(out).toEqual([
      { path: 'docs/x.md', score: 5, lineNumber: 3, snippet: 'hello' },
    ]);
  });

  it('routes concurrent requests by id', async () => {
    const fake = new FakeWorker({ manual: true });
    __setWorkerFactoryForTests(() => fake);

    const p1 = searchDocsInWorker('a', '/repo', 1);
    const p2 = searchDocsInWorker('b', '/repo', 2);

    expect(fake.received.length).toBe(2);
    const [r1, r2] = fake.received;
    expect(r1.query).toBe('a');
    expect(r2.query).toBe('b');

    fake.emit('message', {
      id: r2.id,
      ok: true,
      results: [{ path: 'B.md', score: 2, lineNumber: 1, snippet: '' }],
    } as WorkerResponseShape);
    fake.emit('message', {
      id: r1.id,
      ok: true,
      results: [{ path: 'A.md', score: 1, lineNumber: 1, snippet: '' }],
    } as WorkerResponseShape);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1[0].path).toBe('A.md');
    expect(res2[0].path).toBe('B.md');
  });

  it('falls back to main-thread searchDocs when the worker errors', async () => {
    const fake = new FakeWorker({
      errorAfterFirstMessage: new Error('boom'),
    });
    __setWorkerFactoryForTests(() => fake);

    // Empty query short-circuits searchDocs to []. We use that to verify the
    // fallback path executes without touching disk.
    const out = await searchDocsInWorker('', '/nonexistent', 1);
    expect(out).toEqual([]);
  });

  it('falls back when the factory itself throws', async () => {
    __setWorkerFactoryForTests(() => {
      throw new Error('cannot spawn');
    });

    const out = await searchDocsInWorker('', '/nonexistent', 1);
    expect(out).toEqual([]);
  });

  it('reuses a single worker across calls', async () => {
    let spawnCount = 0;
    const fake = new FakeWorker();
    __setWorkerFactoryForTests(() => {
      spawnCount += 1;
      return fake;
    });

    await searchDocsInWorker('q1', '/repo');
    await searchDocsInWorker('q2', '/repo');
    await searchDocsInWorker('q3', '/repo');

    expect(spawnCount).toBe(1);
  });
});
