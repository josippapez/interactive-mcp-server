'use strict';

const { getDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_file_dependencies',
  description:
    'List import/require dependencies for a repository-relative JavaScript or TypeScript file.',
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
  const edges = index.dependenciesByFile.get(rel) || [];
  const header = `repo ${context.root}\nfile ${rel}\ndependencies`;
  if (edges.length === 0) return `${header}\nnone`;
  return [
    header,
    ...edges.map(
      (edge) =>
        `${edge.to ? 'import' : 'external'}\t${edge.from}\t${edge.to || edge.specifier}`,
    ),
  ].join('\n');
}

module.exports = { fileDependenciesTool: { definition, execute } };
