'use strict';

const path = require('node:path');

function createContext(rootArg, openCodeServerUrlArg) {
  const root = path.resolve(rootArg || process.cwd());
  return {
    root,
    maxFileSizeBytes: 512 * 1024,
    memoriesPath: path.join(root, '.opencode', 'interactive-mcp-memories.json'),
    openCodeServerUrl: openCodeServerUrlArg || 'http://localhost:4096',
    dependencyIndex: null,
    backgroundSubagents: new Map(),
    nextBackgroundId: 1,
  };
}

module.exports = { createContext };
