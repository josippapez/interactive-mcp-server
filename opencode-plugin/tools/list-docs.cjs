'use strict';

const { getDocFiles } = require('../lib/docs.cjs');
const { clampInteger, relativePath } = require('../lib/fs-utils.cjs');

const definition = {
  name: 'list_docs',
  description:
    'List available repository documentation paths so you can browse what exists before searching or reading.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['all', 'docs_only', 'readmes_only'],
        default: 'all',
      },
      limit: { type: 'integer', minimum: 1, maximum: 5000, default: 200 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
};

function execute(args, context) {
  const source = String(args.source || 'all');
  const limit = clampInteger(args.limit, 200, 1, 5000);
  const offset = clampInteger(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!['all', 'docs_only', 'readmes_only'].includes(source))
    return 'Invalid source. Use one of: all, docs_only, readmes_only.';

  let paths = getDocFiles(context).map((filePath) =>
    relativePath(context.root, filePath),
  );
  if (source === 'docs_only')
    paths = paths.filter((item) => item.startsWith('docs/'));
  if (source === 'readmes_only')
    paths = paths.filter(
      (item) =>
        item.toLowerCase().endsWith('/readme.md') || item === 'README.md',
    );
  paths.sort((a, b) => a.localeCompare(b));
  if (paths.length === 0)
    return `No documentation files found for source="${source}".`;
  if (offset >= paths.length)
    return `Offset ${offset} is out of range for ${paths.length} docs.`;

  const page = paths.slice(offset, offset + limit);
  const lines = [
    `Docs list (source=${source}) showing ${page.length} of ${paths.length} total:`,
  ];
  page.forEach((item, index) => lines.push(`${offset + index + 1}. ${item}`));
  if (offset + page.length < paths.length)
    lines.push(
      `More available: call list_docs with offset=${offset + page.length}.`,
    );
  return lines.join('\n');
}

module.exports = { listDocsTool: { definition, execute } };
