#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CACHE_PATH = path.join(__dirname, '.doc-embeddings.json');
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MAX_CHARS_PER_DOC = 2000;
const MAX_FILE_SIZE_BYTES = 512 * 1024;
const SKIP_DIRS = new Set([
  '.git',
  '.nx',
  '.vscode',
  'coverage',
  'dist',
  'evidence',
  'node_modules',
  'tmp',
]);

function walkDirectory(dirPath, visitor) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkDirectory(fullPath, visitor);
      continue;
    }
    if (entry.isFile()) visitor(fullPath);
  }
}

function getDocFiles() {
  const files = [];
  const docsRoot = path.join(ROOT, 'docs');
  if (fs.existsSync(docsRoot)) {
    walkDirectory(docsRoot, (f) => {
      if (f.endsWith('.md') || f.endsWith('.mdx')) files.push(f);
    });
  }
  const rootReadme = path.join(ROOT, 'README.md');
  if (fs.existsSync(rootReadme)) files.push(rootReadme);
  for (const topDir of ['apps', 'libs', 'tools']) {
    const targetDir = path.join(ROOT, topDir);
    if (!fs.existsSync(targetDir)) continue;
    walkDirectory(targetDir, (f) => {
      if (f.toLowerCase().endsWith('/readme.md')) files.push(f);
    });
  }
  return Array.from(new Set(files));
}

(async () => {
  const { pipeline } = await import('@xenova/transformers');
  const embed = await pipeline('feature-extraction', MODEL_ID);
  console.log(`Model loaded. Scanning docs under ${ROOT} ...`);

  const docFiles = getDocFiles();
  const cache = (() => {
    try {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch {
      return {};
    }
  })();

  let updated = 0;
  let skipped = 0;

  for (const filePath of docFiles) {
    let stat, content;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
        skipped++;
        continue;
      }
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      skipped++;
      continue;
    }

    const cached = cache[filePath];
    if (cached && cached.mtime === stat.mtimeMs) {
      skipped++;
      continue;
    }

    const out = await embed(content.slice(0, MAX_CHARS_PER_DOC), {
      pooling: 'mean',
      normalize: true,
    });
    cache[filePath] = { mtime: stat.mtimeMs, vector: Array.from(out.data) };
    updated++;
    process.stdout.write(`  + ${path.relative(ROOT, filePath)}\n`);
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  console.log(
    `\nDone. ${updated} docs indexed, ${skipped} unchanged. Cache: ${CACHE_PATH}`,
  );
})();
