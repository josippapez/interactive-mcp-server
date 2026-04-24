/**
 * Long-lived worker_threads wrapper around `searchDocs`.
 *
 * Why: `searchDocs` does synchronous `readdirSync` + `readFileSync` over the
 * whole repo and CPU-bound scoring on the main thread. This blocks SSE/IPC
 * for tens to hundreds of milliseconds on larger repos. The wrapper offloads
 * that work to a single long-lived worker thread.
 *
 * Public API:
 *   - `searchDocsInWorker(query, baseDirectory, limit?)` — async, mirrors
 *     `searchDocs` and returns the same `DocSearchResult[]` shape.
 *
 * Reliability:
 *   - One in-flight worker is kept alive across calls to amortize startup
 *     cost and let the underlying caches (TTL discovery cache, LRU file
 *     cache) accumulate inside the worker.
 *   - If the worker crashes (`error` or non-zero `exit`), all in-flight
 *     requests reject; the next call lazily spawns a fresh worker.
 *   - If spawning the worker itself fails OR the worker rejects a request,
 *     the wrapper falls back to running `searchDocs` on the main thread once
 *     and logs a warning. This matches the existing direct-call behaviour
 *     so a single worker hiccup never breaks a feature.
 */

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import {
  searchDocs as searchDocsMain,
  type DocSearchResult,
} from './context-injector';

interface PendingRequest {
  resolve: (results: DocSearchResult[]) => void;
  reject: (err: Error) => void;
}

interface WorkerRequest {
  id: number;
  query: string;
  baseDirectory: string;
  limit?: number;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  results?: DocSearchResult[];
  error?: string;
}

// Test-only seam: tests can swap in a fake Worker constructor that mimics
// `new Worker(...)` + `postMessage` + `on('message', ...)` without spawning a
// real thread.
export type WorkerLike = Pick<
  Worker,
  'postMessage' | 'terminate' | 'on' | 'off'
>;

export type WorkerFactory = () => WorkerLike;

let activeWorker: WorkerLike | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

/** Default worker factory — spawns the bundled worker thread file. */
function defaultWorkerFactory(): WorkerLike {
  // The worker script is bundled as a separate entry by electron-vite into
  // `out/main/context-injector-worker.thread.mjs`. In dev (electron-vite dev),
  // the same path holds. We resolve it relative to the main bundle's directory
  // via __dirname which is provided by the electron-vite ESM main runtime.
  const workerPath = join(__dirname, 'context-injector-worker.thread.mjs');
  return new Worker(workerPath);
}

let workerFactory: WorkerFactory = defaultWorkerFactory;

/**
 * Test-only: override the factory used to spawn workers. Pass `null` to
 * restore the default factory. Calling this also tears down any active
 * worker so the next request uses the new factory.
 */
export function __setWorkerFactoryForTests(
  factory: WorkerFactory | null,
): void {
  workerFactory = factory ?? defaultWorkerFactory;
  if (activeWorker) {
    void activeWorker.terminate();
    activeWorker = null;
  }
  // Reject any pending requests since the underlying worker is being replaced.
  for (const { reject } of pending.values()) {
    reject(new Error('worker replaced for tests'));
  }
  pending.clear();
}

function rejectAllPending(err: Error): void {
  for (const { reject } of pending.values()) {
    reject(err);
  }
  pending.clear();
}

function ensureWorker(): WorkerLike {
  if (activeWorker) return activeWorker;

  const w = workerFactory();
  activeWorker = w;

  w.on('message', (msg: WorkerResponse) => {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok && msg.results) {
      entry.resolve(msg.results);
    } else {
      entry.reject(new Error(msg.error ?? 'worker reported failure'));
    }
  });

  w.on('error', (err: Error) => {
    console.warn(
      '[context-injector-worker] worker error, tearing down:',
      err.message,
    );
    rejectAllPending(err);
    if (activeWorker === w) activeWorker = null;
  });

  // worker_threads Worker emits 'exit' with a code (0 = clean). We only wipe
  // state on unexpected exit; clean exits should never happen for our long-
  // lived worker but if they do we still want a fresh spawn next time.
  w.on('exit', (code: number) => {
    if (code !== 0) {
      const err = new Error(`worker exited with code ${code}`);
      console.warn('[context-injector-worker]', err.message);
      rejectAllPending(err);
    }
    if (activeWorker === w) activeWorker = null;
  });

  return w;
}

/**
 * Run `searchDocs` in a long-lived worker thread. Falls back to running
 * `searchDocs` on the main thread once if the worker spawn or call fails.
 */
export async function searchDocsInWorker(
  query: string,
  baseDirectory: string,
  limit: number = 8,
): Promise<DocSearchResult[]> {
  let worker: WorkerLike;
  try {
    worker = ensureWorker();
  } catch (err) {
    console.warn(
      '[context-injector-worker] failed to spawn worker, running searchDocs on main thread:',
      err instanceof Error ? err.message : err,
    );
    return searchDocsMain(query, baseDirectory, limit);
  }

  const id = nextRequestId++;
  const req: WorkerRequest = { id, query, baseDirectory, limit };

  try {
    return await new Promise<DocSearchResult[]>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage(req);
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error('postMessage failed'));
      }
    });
  } catch (err) {
    console.warn(
      '[context-injector-worker] worker call failed, falling back to main-thread searchDocs:',
      err instanceof Error ? err.message : err,
    );
    return searchDocsMain(query, baseDirectory, limit);
  }
}

/**
 * Test-only: tear down the active worker (if any). Useful between tests.
 */
export async function __shutdownWorkerForTests(): Promise<void> {
  if (activeWorker) {
    const w = activeWorker;
    activeWorker = null;
    rejectAllPending(new Error('worker shut down for tests'));
    await w.terminate();
  }
}
