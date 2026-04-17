/**
 * Semantic document indexer using a worker thread.
 *
 * Architecture mirrors tools/mcp/semantic-index.cjs but is written in
 * TypeScript for the Electron main process.
 *
 * The file uses `isMainThread` to split behaviour:
 * - Worker side: loads @huggingface/transformers, runs the feature-extraction pipeline.
 * - Main side: exports warmUp(), embedText(), findSemantic(), etc.
 *
 * The worker is spawned by passing __filename to `new Worker()`, so
 * electron-vite must externalise the dependency (handled by externalizeDepsPlugin).
 */

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from '../utils/errors';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MAX_CHARS_PER_DOC = 2000;
const MAX_CHARS_PER_QUERY = 500;
const SEMANTIC_THRESHOLD = 0.3;
const SEMANTIC_WEIGHT = 14;
const CACHE_FILENAME = '.doc-embeddings.json';

// ── Worker side ─────────────────────────────────────────────────────────────

if (!isMainThread && parentPort) {
  const port = parentPort;
  (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const embed = await pipeline('feature-extraction', MODEL_ID);

    port.on(
      'message',
      async (msg: { type: string; id: number; text: string }) => {
        if (msg.type === 'embed') {
          try {
            const out = await embed(msg.text, {
              pooling: 'mean',
              normalize: true,
            });
            port.postMessage({
              type: 'embed',
              id: msg.id,
              vector: Array.from(out.data as Float32Array),
            });
          } catch (err) {
            port.postMessage({
              type: 'error',
              message: errorMessage(err),
            });
          }
        }
      },
    );

    port.postMessage({ type: 'ready' });
  })().catch((err) => {
    port.postMessage({
      type: 'error',
      message: errorMessage(err),
    });
    process.exit(1);
  });
}

// ── Main thread side ────────────────────────────────────────────────────────

export interface DocEmbeddingEntry {
  mtime: number;
  vector: number[];
  title: string | null;
}

export interface DocEmbeddingCache {
  [relativePath: string]: DocEmbeddingEntry;
}

export interface SemanticHit {
  path: string;
  score: number;
}

let _worker: Worker | null = null;
let _workerReady = false;
const _pending = new Map<number, (vector: number[] | null) => void>();
let _msgId = 0;
let _buildingCache = false;

/**
 * Spawn the embedding worker. Safe to call multiple times — subsequent calls
 * are no-ops while a worker is alive.
 */
export function warmUp(): void {
  if (!isMainThread) return;
  if (_worker) return;

  _worker = new Worker(__filename);

  _worker.on(
    'message',
    (msg: {
      type: string;
      id?: number;
      vector?: number[];
      message?: string;
    }) => {
      if (msg.type === 'ready') {
        _workerReady = true;
        console.log('[doc-indexer] embedding worker ready');
        return;
      }
      if (msg.type === 'embed' && msg.id !== undefined) {
        const resolve = _pending.get(msg.id);
        if (resolve) {
          _pending.delete(msg.id);
          resolve(msg.vector ?? null);
        }
        return;
      }
      if (msg.type === 'error') {
        console.error('[doc-indexer] worker error:', msg.message);
      }
    },
  );

  _worker.on('error', (err: Error) => {
    console.error('[doc-indexer] worker crash:', err.message);
    _worker = null;
    _workerReady = false;
  });

  _worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[doc-indexer] worker exited with code ${code}`);
    }
    _worker = null;
    _workerReady = false;
  });
}

/** Check if the embedding worker is warmed up and ready. */
export function isReady(): boolean {
  return _workerReady;
}

/** Shut down the worker thread. Resolves after the worker fully terminates. */
export async function shutdown(): Promise<void> {
  if (!_worker) return;
  const worker = _worker;
  _worker = null;
  _workerReady = false;
  _pending.clear();
  await worker.terminate();
}

/** Embed text via the worker. Returns null if worker is not ready. */
export async function embedText(text: string): Promise<number[] | null> {
  if (!_workerReady || !_worker) return null;
  return new Promise((resolve) => {
    const id = ++_msgId;
    _pending.set(id, resolve);
    _worker!.postMessage({ type: 'embed', id, text });
  });
}

// ── Cache operations ────────────────────────────────────────────────────────

function getCachePath(baseDirectory: string): string {
  return join(baseDirectory, CACHE_FILENAME);
}

export function loadCache(baseDirectory: string): DocEmbeddingCache {
  try {
    const data = readFileSync(getCachePath(baseDirectory), 'utf8');
    return JSON.parse(data) as DocEmbeddingCache;
  } catch {
    return {};
  }
}

export function saveCache(
  baseDirectory: string,
  cache: DocEmbeddingCache,
): void {
  try {
    writeFileSync(getCachePath(baseDirectory), JSON.stringify(cache));
  } catch (err) {
    console.error(
      '[doc-indexer] failed to save cache:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ── Similarity ──────────────────────────────────────────────────────────────

/** Cosine similarity (vectors are pre-normalised, so dot product suffices). */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ── Background cache builder ────────────────────────────────────────────────

/**
 * Extract the first H1 heading from markdown content.
 */
export function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

/**
 * Build embedding cache for uncached files in the background.
 * Fire-and-forget — uncached files will be available on the NEXT search.
 */
async function buildCacheBackground(
  uncachedFiles: { absPath: string; relPath: string }[],
  baseDirectory: string,
): Promise<void> {
  if (_buildingCache) return;
  _buildingCache = true;

  try {
    const cache = loadCache(baseDirectory);
    for (const { absPath, relPath } of uncachedFiles) {
      if (!_workerReady) break;
      let content: string;
      let fileStat: ReturnType<typeof statSync>;
      try {
        fileStat = statSync(absPath);
        content = readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }
      const vec = await embedText(content.slice(0, MAX_CHARS_PER_DOC));
      if (vec) {
        cache[relPath] = {
          mtime: fileStat.mtimeMs,
          vector: vec,
          title: extractTitle(content),
        };
      }
    }
    saveCache(baseDirectory, cache);
  } finally {
    _buildingCache = false;
  }
}

// ── Semantic search ─────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 512 * 1024;

/**
 * Find semantically similar docs using cached embeddings.
 * Returns scored hits sorted by similarity descending.
 */
export async function findSemantic(
  query: string,
  docFiles: { absPath: string; relPath: string }[],
  baseDirectory: string,
  limit: number,
): Promise<SemanticHit[]> {
  if (!_workerReady) return [];

  const queryVec = await embedText(query.slice(0, MAX_CHARS_PER_QUERY));
  if (!queryVec) return [];

  const cache = loadCache(baseDirectory);
  const results: SemanticHit[] = [];
  const uncachedFiles: { absPath: string; relPath: string }[] = [];

  for (const { absPath, relPath } of docFiles) {
    let fileStat: ReturnType<typeof statSync>;
    try {
      fileStat = statSync(absPath);
      if (!fileStat.isFile() || fileStat.size > MAX_FILE_SIZE_BYTES) continue;
    } catch {
      continue;
    }

    const cached = cache[relPath];
    if (cached && cached.mtime === fileStat.mtimeMs && cached.vector) {
      results.push({
        path: relPath,
        score: cosine(queryVec, cached.vector),
      });
    } else {
      uncachedFiles.push({ absPath, relPath });
    }
  }

  // Kick off background indexing for uncached files
  if (uncachedFiles.length > 0) {
    setImmediate(() => {
      buildCacheBackground(uncachedFiles, baseDirectory).catch(() => {});
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Full cache build (for initial indexing) ─────────────────────────────────

/**
 * Build or refresh the embedding cache for all given doc files.
 * Called once after registration to pre-populate the cache in the background.
 */
export async function buildFullCache(
  docFiles: { absPath: string; relPath: string }[],
  baseDirectory: string,
): Promise<void> {
  if (_buildingCache) return;
  _buildingCache = true;

  try {
    const cache = loadCache(baseDirectory);
    let updated = 0;

    for (const { absPath, relPath } of docFiles) {
      if (!_workerReady) break;

      let content: string;
      let fileStat: ReturnType<typeof statSync>;
      try {
        fileStat = statSync(absPath);
        if (!fileStat.isFile() || fileStat.size > MAX_FILE_SIZE_BYTES) continue;
        content = readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      // Skip if cache entry is still fresh
      const cached = cache[relPath];
      if (cached && cached.mtime === fileStat.mtimeMs && cached.vector) {
        continue;
      }

      const vec = await embedText(content.slice(0, MAX_CHARS_PER_DOC));
      if (vec) {
        cache[relPath] = {
          mtime: fileStat.mtimeMs,
          vector: vec,
          title: extractTitle(content),
        };
        updated++;
      }
    }

    // Prune entries for files that no longer exist
    const validPaths = new Set(docFiles.map((f) => f.relPath));
    for (const key of Object.keys(cache)) {
      if (!validPaths.has(key)) {
        delete cache[key];
      }
    }

    saveCache(baseDirectory, cache);
    console.log(
      `[doc-indexer] cache built: ${updated} new/updated, ${docFiles.length} total docs`,
    );
  } finally {
    _buildingCache = false;
  }
}

export {
  SEMANTIC_THRESHOLD,
  SEMANTIC_WEIGHT,
  MAX_FILE_SIZE_BYTES as DOC_MAX_FILE_SIZE,
};
