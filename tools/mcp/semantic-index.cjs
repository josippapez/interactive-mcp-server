'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const { ROOT, MAX_FILE_SIZE_BYTES } = require('./config.cjs');

const CACHE_PATH = path.join(__dirname, '.doc-embeddings.json');
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MAX_CHARS_PER_DOC = 2000;

if (!isMainThread) {
  (async () => {
    const { pipeline } = await import('@xenova/transformers');
    const embed = await pipeline('feature-extraction', MODEL_ID);

    parentPort.on('message', async (msg) => {
      if (msg.type === 'embed') {
        const out = await embed(msg.text, { pooling: 'mean', normalize: true });
        parentPort.postMessage({
          type: 'embed',
          id: msg.id,
          vector: Array.from(out.data),
        });
      }
    });

    parentPort.postMessage({ type: 'ready' });
  })().catch((err) => {
    parentPort.postMessage({ type: 'error', message: err.message });
    process.exit(1);
  });
  return;
}

let _worker = null;
let _workerReady = false;
const _pending = new Map();
let _msgId = 0;
let _buildingCache = false;

function warmUp() {
  if (_worker) return;
  _worker = new Worker(__filename);
  _worker.on('message', (msg) => {
    if (msg.type === 'ready') {
      _workerReady = true;
      return;
    }
    if (msg.type === 'embed') {
      const resolve = _pending.get(msg.id);
      if (resolve) {
        _pending.delete(msg.id);
        resolve(msg.vector);
      }
      return;
    }
    if (msg.type === 'error') {
      process.stderr.write(`semantic worker error: ${msg.message}\n`);
    }
  });
  _worker.on('error', (err) => {
    process.stderr.write(`semantic worker crash: ${err.message}\n`);
    _worker = null;
    _workerReady = false;
  });
}

function isReady() {
  return _workerReady;
}

async function embedText(text) {
  if (!_workerReady) return null;
  return new Promise((resolve) => {
    const id = ++_msgId;
    _pending.set(id, resolve);
    _worker.postMessage({ type: 'embed', id, text });
  });
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch {}
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function buildCacheBackground(uncachedFiles) {
  if (_buildingCache) return;
  _buildingCache = true;
  const cache = loadCache();
  for (const filePath of uncachedFiles) {
    if (!_workerReady) break;
    let stat, content;
    try {
      stat = fs.statSync(filePath);
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const vec = await embedText(content.slice(0, MAX_CHARS_PER_DOC));
    if (vec) {
      cache[filePath] = { mtime: stat.mtimeMs, vector: vec };
    }
  }
  saveCache(cache);
  _buildingCache = false;
}

async function findSemantic(query, docFiles, limit) {
  if (!_workerReady) return [];

  const queryVec = await embedText(query.slice(0, 500));
  if (!queryVec) return [];

  const cache = loadCache();
  const results = [];
  const uncachedFiles = [];

  for (const filePath of docFiles) {
    let stat;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) continue;
    } catch {
      continue;
    }

    const cached = cache[filePath];
    if (cached && cached.mtime === stat.mtimeMs) {
      results.push({
        path: path.relative(ROOT, filePath),
        score: cosine(queryVec, cached.vector),
      });
    } else {
      uncachedFiles.push(filePath);
    }
  }

  if (uncachedFiles.length > 0) {
    setImmediate(() => buildCacheBackground(uncachedFiles).catch(() => {}));
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

module.exports = { warmUp, isReady, findSemantic };
