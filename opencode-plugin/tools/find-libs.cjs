'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { clampInteger, tokenize } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'find_libs',
  description:
    'Search repository package.json dependencies/devDependencies and return matching package names.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const query = String(args.query || '').trim();
  const limit = clampInteger(args.limit, 20, 1, 50);
  if (!query) return 'Please provide a non-empty query.';
  let packageJson = {};
  try {
    packageJson = JSON.parse(
      fs.readFileSync(path.join(context.root, 'package.json'), 'utf8'),
    );
  } catch {
    return 'Unable to read package.json.';
  }
  const all = [
    ...Object.entries(packageJson.dependencies || {}).map(
      ([name, version]) => ({ name, version, kind: 'dependency' }),
    ),
    ...Object.entries(packageJson.devDependencies || {}).map(
      ([name, version]) => ({ name, version, kind: 'devDependency' }),
    ),
  ];
  const tokens = tokenize(query);
  const matches = [];
  for (const item of all) {
    const lowerName = item.name.toLowerCase();
    let score = lowerName.includes(query.toLowerCase()) ? 10 : 0;
    for (const token of tokens) if (lowerName.includes(token)) score += 4;
    if (score > 0) matches.push({ ...item, score });
  }
  if (matches.length === 0) return `No library matches found for "${query}".`;
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return [
    `Top library matches for "${query}":`,
    ...matches
      .slice(0, limit)
      .map(
        (item, index) =>
          `${index + 1}. ${item.name}@${item.version} [${item.kind}] (score: ${item.score})`,
      ),
  ].join('\n');
}

module.exports = { findLibsTool: { definition, execute } };
