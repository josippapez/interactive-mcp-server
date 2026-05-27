'use strict';

const { getDependencyIndex } = require('../lib/dependency-index.cjs');
const { clampInteger } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'get_blast_radius',
  description:
    'Return a lightweight transitive dependent set for one or more repository-relative files.',
  inputSchema: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, minItems: 1 },
      maxDepth: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    },
    required: ['paths'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const roots = Array.isArray(args.paths) ? args.paths.map(String) : [];
  const maxDepth = clampInteger(args.maxDepth, 3, 0, 10);
  const limit = clampInteger(args.limit, 100, 1, 500);
  if (roots.length === 0) return 'Please provide at least one path.';
  const index = getDependencyIndex(context);
  const queue = roots.map((item) => ({ path: item, distance: 0, via: null }));
  const seen = new Map();
  for (const item of queue) seen.set(item.path, item);
  for (
    let cursor = 0;
    cursor < queue.length && queue.length < limit;
    cursor += 1
  ) {
    const current = queue[cursor];
    if (current.distance >= maxDepth) continue;
    for (const edge of index.dependentsByFile.get(current.path) || []) {
      if (seen.has(edge.from)) continue;
      const next = {
        path: edge.from,
        distance: current.distance + 1,
        via: current.path,
      };
      seen.set(next.path, next);
      queue.push(next);
      if (queue.length >= limit) break;
    }
  }
  const lines = [
    `repo ${context.root}`,
    `roots ${roots.join(',')}`,
    `maxDepth ${maxDepth}`,
  ];
  for (const item of queue)
    lines.push(
      `d${item.distance}\t${item.path}${item.via ? `\tvia ${item.via}` : ''}`,
    );
  return lines.join('\n');
}

module.exports = { blastRadiusTool: { definition, execute } };
