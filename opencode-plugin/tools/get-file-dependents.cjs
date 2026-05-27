'use strict';

const { getDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependents',
  description:
    'List repository files that import or require a repository-relative JavaScript or TypeScript file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
};

function execute(args, context) {
  const rel = String(args.path || '').trim();
  if (!rel) return 'Please provide a non-empty path.';
  const index = getDependencyIndex(context);
  const edges = index.dependentsByFile.get(rel) || [];
  const header = `repo ${context.root}\nfile ${rel}\ndependents`;
  if (edges.length === 0) return `${header}\nnone`;
  return [
    header,
    ...edges.map((edge) => `import\t${edge.from}\t${rel}\t${edge.specifier}`),
  ].join('\n');
}

module.exports = { fileDependentsTool: { definition, execute } };
