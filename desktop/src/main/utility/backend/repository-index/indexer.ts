import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  deleteRepositoryFile,
  getRepositoryFile,
  markRepositoryIndexError,
  markRepositoryIndexing,
  replaceRepositoryIndex,
  updateRepositoryIndexProgress,
  upsertRepositoryFileWithEdges,
} from '../database';
import { extractDependenciesFromSource } from './dependency-extractor';
import { resolveDependencySpecifier } from './dependency-resolver';
import {
  canExtractDependencies,
  detectLanguage,
  isGitRepositoryRoot,
  isIgnoredRepositoryPath,
  isIndexableFile,
  normalizeRepositoryRoot,
  toRepositoryRelativePath,
} from './path-utils';
import type {
  RepositoryDependencyEdge,
  RepositoryFileRecord,
  RepositoryIndexSummary,
} from './types';

const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 1024 * 1024;
const PROGRESS_UPDATE_INTERVAL = 100;
const INDEX_VERSION = 1;

export function validateRepositoryRoot(repositoryRoot: string): string | null {
  const normalized = normalizeRepositoryRoot(repositoryRoot);
  if (normalized === '/') return 'Refusing to index filesystem root.';
  if (normalized === homedir())
    return 'Refusing to index the entire home directory.';
  if (!isGitRepositoryRoot(normalized)) {
    return 'Repository indexing requires the selected folder to be a git repository.';
  }
  return null;
}

export async function indexRepository(
  repositoryRoot: string,
  opts: { watcherEnabled: boolean } = { watcherEnabled: false },
): Promise<RepositoryIndexSummary> {
  const root = normalizeRepositoryRoot(repositoryRoot);
  const validationError = validateRepositoryRoot(root);
  if (validationError) {
    const status = markRepositoryIndexError(root, validationError);
    if (!status) throw new Error(validationError);
    return { status, filesIndexed: 0, edgesIndexed: 0 };
  }

  try {
    const paths = await discoverRepositoryFiles(root);
    markRepositoryIndexing(root, opts.watcherEnabled, paths.length);
    const files: Array<
      Omit<RepositoryFileRecord, 'repositoryRoot' | 'updatedAt'>
    > = [];
    const edges: Array<Omit<RepositoryDependencyEdge, 'repositoryRoot'>> = [];

    for (const [index, path] of paths.entries()) {
      const indexedFile = await indexSingleFile(root, path);
      if (!indexedFile) continue;
      files.push(indexedFile.file);
      edges.push(...indexedFile.edges);
      if ((index + 1) % PROGRESS_UPDATE_INTERVAL === 0) {
        updateRepositoryIndexProgress(root, index + 1, edges.length);
      }
    }
    updateRepositoryIndexProgress(root, files.length, edges.length);

    const status = replaceRepositoryIndex({
      repositoryRoot: root,
      files,
      edges,
      watcherEnabled: opts.watcherEnabled,
      indexVersion: INDEX_VERSION,
    });
    if (!status)
      throw new Error('Repository index database is not initialized.');
    return { status, filesIndexed: files.length, edgesIndexed: edges.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = markRepositoryIndexError(root, message);
    if (!status) throw error;
    return { status, filesIndexed: 0, edgesIndexed: 0 };
  }
}

export async function indexChangedPath(
  repositoryRoot: string,
  absolutePath: string,
): Promise<void> {
  const root = normalizeRepositoryRoot(repositoryRoot);
  const relPath = toRepositoryRelativePath(root, absolutePath);
  if (!relPath) return;

  if (!isIndexableFile(relPath)) {
    deleteRepositoryFile(root, relPath);
    return;
  }

  const indexedFile = await indexSingleFile(root, relPath);
  if (!indexedFile) {
    deleteRepositoryFile(root, relPath);
    return;
  }

  const existing = getRepositoryFile(root, relPath);
  if (existing?.contentHash === indexedFile.file.contentHash) return;

  upsertRepositoryFileWithEdges({
    repositoryRoot: root,
    file: indexedFile.file,
    edges: indexedFile.edges,
  });
}

export function deleteChangedPath(
  repositoryRoot: string,
  absolutePath: string,
): void {
  const root = normalizeRepositoryRoot(repositoryRoot);
  const relPath = toRepositoryRelativePath(root, absolutePath);
  if (!relPath) return;
  deleteRepositoryFile(root, relPath);
}

async function discoverRepositoryFiles(
  repositoryRoot: string,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDirectory: string): Promise<void> {
    if (files.length >= MAX_FILES) return;
    const absoluteDirectory = join(repositoryRoot, relativeDirectory);
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const relPath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (isIgnoredRepositoryPath(relPath)) continue;
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (entry.isFile() && !isIgnoredRepositoryPath(relPath)) {
        files.push(relPath);
      }
    }
  }

  await walk('');
  files.sort();
  return files;
}

async function indexSingleFile(
  repositoryRoot: string,
  path: string,
): Promise<{
  file: Omit<RepositoryFileRecord, 'repositoryRoot' | 'updatedAt'>;
  edges: Array<Omit<RepositoryDependencyEdge, 'repositoryRoot'>>;
} | null> {
  const absolutePath = join(repositoryRoot, path);
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;

  const contentHash = await hashFile(absolutePath);
  const dependencies =
    canExtractDependencies(path) && stats.size <= MAX_FILE_BYTES
      ? extractDependenciesFromSource(
          await readFile(absolutePath, 'utf8'),
          path,
        )
      : [];
  const edges = dependencies.map((dependency) => {
    const resolved = resolveDependencySpecifier(
      repositoryRoot,
      path,
      dependency.specifier,
    );
    return {
      fromPath: path,
      toPath: resolved.toPath,
      specifier: dependency.specifier,
      kind: dependency.kind,
      isExternal: resolved.isExternal,
      lineNumber: dependency.lineNumber,
      lineSnippet: dependency.lineSnippet,
    };
  });

  return {
    file: {
      path,
      language: detectLanguage(path),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      contentHash,
    },
    edges,
  };
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
