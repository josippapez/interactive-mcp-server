'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SERVER_INFO = {
  name: 'repo-docs-libs',
  version: '0.1.0',
};

const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';
const ROOT = path.resolve(__dirname, '../..');
const MAX_FILE_SIZE_BYTES = 512 * 1024;

// Always-skip dirs regardless of .gitignore
const BASE_SKIP_DIRS = new Set([
  '.git',
  '.nx',
  '.vscode',
  'coverage',
  'dist',
  'evidence',
  'evidence-tmp',
  'node_modules',
  'Pods',
  'tmp',
]);

function loadGitignoreDirs(root) {
  const dirs = new Set();
  try {
    const lines = fs
      .readFileSync(path.join(root, '.gitignore'), 'utf8')
      .split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      if (line.includes('*') || line.includes('?')) continue;
      // Strip leading/trailing slashes, keep only simple names (no path separators)
      const name = line.replace(/^\//, '').replace(/\/$/, '');
      if (name && !name.includes('/') && !name.startsWith('.')) {
        dirs.add(name);
      }
    }
  } catch {
    /* .gitignore not present — use base set only */
  }
  return dirs;
}

const SKIP_DIRS = new Set([...BASE_SKIP_DIRS, ...loadGitignoreDirs(ROOT)]);

module.exports = {
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSION,
  ROOT,
  MAX_FILE_SIZE_BYTES,
  SKIP_DIRS,
};
