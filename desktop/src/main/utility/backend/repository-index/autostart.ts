import {
  getRepositoryIndex,
  getAllRegisteredConnections,
  type RegisteredConnection,
} from '../database';
import { getSettingsSnapshot } from '../settings-mirror';
import { indexRepository, validateRepositoryRoot } from './indexer';
import { normalizeRepositoryRoot } from './path-utils';
import { ensureRepositoryWatcher } from './watcher';
import type { RepositoryIndexRecord, RepositoryIndexSummary } from './types';

type Dependencies = {
  enabled?: boolean;
  getIndex: (root: string) => RepositoryIndexRecord | null;
  indexRepository: (root: string) => Promise<RepositoryIndexSummary>;
  validateRepositoryRoot: (root: string) => string | null;
  ensureWatcher: (root: string) => string | null;
  normalizeRepositoryRoot: (root: string) => string;
};

const runningRoots = new Set<string>();

export function startMissingRepositoryIndexes(
  baseDirectories: Array<string | null | undefined>,
  deps: Dependencies = {
    getIndex: getRepositoryIndex,
    indexRepository: (root) => indexRepository(root, { watcherEnabled: true }),
    validateRepositoryRoot,
    ensureWatcher: ensureRepositoryWatcher,
    normalizeRepositoryRoot,
  },
): Promise<RepositoryIndexSummary | null>[] {
  if (deps.enabled === false) return [];

  const roots = new Set(
    baseDirectories
      .map((baseDirectory) => baseDirectory?.trim() ?? '')
      .filter(Boolean)
      .map((baseDirectory) => deps.normalizeRepositoryRoot(baseDirectory)),
  );

  const tasks: Promise<RepositoryIndexSummary | null>[] = [];
  for (const root of roots) {
    if (runningRoots.has(root)) continue;
    const existing = deps.getIndex(root);
    if (existing?.status === 'ready' || existing?.status === 'indexing') {
      continue;
    }
    if (deps.validateRepositoryRoot(root)) continue;

    const watcherError = deps.ensureWatcher(root);
    if (watcherError) continue;

    runningRoots.add(root);
    const task = deps.indexRepository(root).finally(() => {
      runningRoots.delete(root);
    });
    tasks.push(task);
  }
  return tasks;
}

export function startMissingIndexesForRegisteredConnections(
  connections: RegisteredConnection[] = getAllRegisteredConnections(),
): void {
  if (!getSettingsSnapshot().docIndexingEnabled) return;
  for (const task of startMissingRepositoryIndexes(
    connections
      .filter((connection) => connection.providerType === 'opencode')
      .map((connection) => connection.baseDirectory),
  )) {
    task.catch((error: unknown) => {
      console.warn(
        `[repository-index] automatic indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

export function startMissingIndexForBaseDirectory(
  baseDirectory: string | null | undefined,
): void {
  if (!getSettingsSnapshot().docIndexingEnabled) return;
  for (const task of startMissingRepositoryIndexes([baseDirectory])) {
    task.catch((error: unknown) => {
      console.warn(
        `[repository-index] automatic indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
