'use strict';

const { relativePath, walkDirectory } = require('./fs-utils.cjs');

function getDocFiles(context) {
  const files = [];
  walkDirectory(context.root, (filePath) => {
    const rel = relativePath(context.root, filePath);
    const lower = rel.toLowerCase();
    if (
      rel.startsWith('docs/') &&
      (lower.endsWith('.md') || lower.endsWith('.mdx'))
    ) {
      files.push(filePath);
      return;
    }
    if (lower === 'readme.md' || lower.endsWith('/readme.md'))
      files.push(filePath);
  });
  return Array.from(new Set(files));
}

module.exports = { getDocFiles };
