const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../config.cjs');

const libsTool = {
  name: 'find_libs',
  description:
    'Find relevant npm libraries from package.json dependencies/devDependencies.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Library search query (for example: tanstack router).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of matches to return.',
        minimum: 1,
        maximum: 50,
        default: 20,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

function tokenize(input) {
  return String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/g)
    .filter(Boolean);
}

function findLibs(args) {
  const query = String(args?.query || '').trim();
  const limit = Math.min(Math.max(Number(args?.limit || 20), 1), 50);
  if (!query) {
    return 'Please provide a non-empty query.';
  }

  const packageJsonPath = path.join(ROOT, 'package.json');
  let packageJson = {};
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return 'Unable to read package.json.';
  }

  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const all = [
    ...Object.entries(dependencies).map(([name, version]) => ({
      name,
      version,
      kind: 'dependency',
    })),
    ...Object.entries(devDependencies).map(([name, version]) => ({
      name,
      version,
      kind: 'devDependency',
    })),
  ];

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return 'Please provide a more specific query.';
  }

  const matches = [];
  for (const pkg of all) {
    const lowerName = pkg.name.toLowerCase();
    let score = 0;
    if (lowerName.includes(query.toLowerCase())) {
      score += 10;
    }
    for (const token of tokens) {
      if (lowerName.includes(token)) {
        score += 4;
      }
    }
    if (score > 0) {
      matches.push({ ...pkg, score });
    }
  }

  if (matches.length === 0) {
    return `No library matches found for "${query}".`;
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = matches.slice(0, limit);
  const lines = [`Top library matches for "${query}":`];
  top.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.name}@${item.version} [${item.kind}] (score: ${item.score})`,
    );
  });

  return lines.join('\n');
}

module.exports = { libsTool, findLibs };
