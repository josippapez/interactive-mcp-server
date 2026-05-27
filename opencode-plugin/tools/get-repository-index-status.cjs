'use strict';

const { getDependencyIndex } = require('../lib/dependency-index.cjs');

const definition = {
  name: 'get_repository_index_status',
  description:
    'Report lightweight repository dependency index status for this standalone MCP.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function execute(_args, context) {
  const index = getDependencyIndex(context);
  return [
    `repo ${context.root}`,
    'status ready',
    `files ${index.sourceFiles.length}/${index.sourceFiles.length}`,
    `edges ${index.edgeCount}`,
    'watcher no',
  ].join('\n');
}

module.exports = { repositoryIndexStatusTool: { definition, execute } };
