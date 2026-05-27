'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { relativePath, walkDirectory } = require('./fs-utils.cjs');

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

function getSourceFiles(context) {
  const files = [];
  walkDirectory(context.root, (filePath) => {
    if (SOURCE_EXTENSIONS.has(path.extname(filePath))) files.push(filePath);
  });
  return files;
}

function resolveImportPath(context, fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...Array.from(SOURCE_EXTENSIONS, (ext) => `${base}${ext}`),
    ...Array.from(SOURCE_EXTENSIONS, (ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile())
        return relativePath(context.root, candidate);
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function parseDependencies(context, filePath) {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const edges = [];
  const rel = relativePath(context.root, filePath);
  const matcher =
    /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|require\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(matcher)) {
    const specifier = match[1];
    edges.push({
      from: rel,
      specifier,
      to: resolveImportPath(context, filePath, specifier),
    });
  }
  return edges;
}

function getDependencyIndex(context) {
  if (context.dependencyIndex) return context.dependencyIndex;
  const sourceFiles = getSourceFiles(context);
  const dependenciesByFile = new Map();
  const dependentsByFile = new Map();
  let edgeCount = 0;
  for (const filePath of sourceFiles) {
    const rel = relativePath(context.root, filePath);
    const edges = parseDependencies(context, filePath);
    dependenciesByFile.set(rel, edges);
    edgeCount += edges.length;
    for (const edge of edges) {
      if (!edge.to) continue;
      if (!dependentsByFile.has(edge.to)) dependentsByFile.set(edge.to, []);
      dependentsByFile.get(edge.to).push(edge);
    }
  }
  context.dependencyIndex = {
    sourceFiles,
    dependenciesByFile,
    dependentsByFile,
    edgeCount,
  };
  return context.dependencyIndex;
}

module.exports = { getDependencyIndex };
