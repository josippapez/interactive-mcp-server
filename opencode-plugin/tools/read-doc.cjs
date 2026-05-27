'use strict';

const fs = require('node:fs');
const { resolveInsideRoot } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'read_doc',
  description:
    'Read the full content of a repository documentation file by its relative path. Use find_docs first to discover relevant file paths.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const relPath = String(args.path || '').trim();
  if (!relPath) return 'Please provide a non-empty path.';
  const absPath = resolveInsideRoot(context.root, relPath);
  if (!absPath) return 'Path is outside the repository root.';
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return `File not found: ${relPath}`;
  }
  if (!stat.isFile()) return `Not a regular file: ${relPath}`;
  if (stat.size > context.maxFileSizeBytes)
    return `File too large (${stat.size} bytes, max ${context.maxFileSizeBytes}): ${relPath}`;
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return `Read error: ${err.message}`;
  }
}

module.exports = { readDocTool: { definition, execute } };
