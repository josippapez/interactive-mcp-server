'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set([
  '.git',
  '.nx',
  '.opencode',
  '.vscode',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'tmp',
]);

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

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

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function resolveInsideRoot(root, relPath) {
  const resolved = path.resolve(root, String(relPath || ''));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    return null;
  return resolved;
}

function tokenize(input) {
  return String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/g)
    .filter(Boolean);
}

module.exports = {
  clampInteger,
  relativePath,
  resolveInsideRoot,
  tokenize,
  walkDirectory,
};
