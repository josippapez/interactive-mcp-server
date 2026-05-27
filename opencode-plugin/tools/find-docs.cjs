'use strict';

const fs = require('node:fs');
const { getDocFiles } = require('../lib/docs.cjs');
const { clampInteger, relativePath, tokenize } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'find_docs',
  description:
    'Find relevant repository docs by query without loading all docs up front.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const query = String(args.query || '').trim();
  const limit = clampInteger(args.limit, 8, 1, 20);
  const tokens = tokenize(query);
  if (!query || tokens.length === 0) return 'Please provide a non-empty query.';

  const matches = [];
  for (const filePath of getDocFiles(context)) {
    let content = '';
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > context.maxFileSizeBytes) continue;
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const rel = relativePath(context.root, filePath);
    const lowerPath = rel.toLowerCase();
    const lowerContent = content.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lowerPath.includes(token)) score += 4;
      if (lowerContent.includes(token)) score += 1;
    }
    if (score <= 0) continue;
    const lines = content.split(/\r?\n/g);
    const lineIndex = lines.findIndex((line) =>
      tokens.some((token) => line.toLowerCase().includes(token)),
    );
    matches.push({
      rel,
      score,
      lineIndex,
      snippet: lineIndex >= 0 ? lines[lineIndex].trim() : '',
    });
  }

  if (matches.length === 0) return `No doc matches found for "${query}".`;
  matches.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const lines = [`Top doc matches for "${query}":`];
  for (const [index, item] of matches.slice(0, limit).entries()) {
    lines.push(`${index + 1}. ${item.rel} (score: ${item.score})`);
    if (item.snippet) lines.push(`   L${item.lineIndex + 1}: ${item.snippet}`);
  }
  return lines.join('\n');
}

module.exports = { findDocsTool: { definition, execute } };
