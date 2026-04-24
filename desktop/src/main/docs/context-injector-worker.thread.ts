/**
 * Worker thread entry for off-main-thread doc search.
 *
 * Receives `{ id, query, baseDirectory, limit }` messages over `parentPort`
 * and replies with `{ id, ok: true, results }` or `{ id, ok: false, error }`.
 *
 * The worker imports the existing `searchDocs` from `context-injector.ts`,
 * so any caches (TTL discovery cache, LRU file content cache) added to that
 * module live inside the worker and are automatically reused across requests.
 *
 * NOTE: This file is bundled as a separate entry by electron-vite (see
 * `electron.vite.config.ts` `main.build.rollupOptions.input`). At runtime the
 * wrapper resolves it relative to `__dirname` of the main bundle.
 */

import { parentPort } from 'node:worker_threads';
import { searchDocs, type DocSearchResult } from './context-injector';

interface WorkerRequest {
  id: number;
  query: string;
  baseDirectory: string;
  limit?: number;
}

interface WorkerResponseOk {
  id: number;
  ok: true;
  results: DocSearchResult[];
}

interface WorkerResponseErr {
  id: number;
  ok: false;
  error: string;
}

if (!parentPort) {
  throw new Error(
    '[context-injector-worker.thread] must be run as a worker_threads worker',
  );
}

const port = parentPort;

port.on('message', async (msg: WorkerRequest) => {
  const { id, query, baseDirectory, limit } = msg;
  try {
    const results = await searchDocs(query, baseDirectory, limit ?? 8);
    const reply: WorkerResponseOk = { id, ok: true, results };
    port.postMessage(reply);
  } catch (err) {
    const reply: WorkerResponseErr = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    port.postMessage(reply);
  }
});
