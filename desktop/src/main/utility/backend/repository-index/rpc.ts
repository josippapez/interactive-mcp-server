import type { Bridge } from '../../bridge';
import {
  getRepositoryIndex,
  getRepositoryBlastRadius,
  getRepositoryDependencies,
  getRepositoryDependents,
  getRegisteredConnectionBySessionId,
} from '../database';
import { indexRepository, validateRepositoryRoot } from './indexer';
import { normalizeRepositoryRoot } from './path-utils';
import {
  ensureRepositoryWatcher,
  getWatchedRepositoryRoots,
  stopRepositoryWatcher,
} from './watcher';

interface ArgsEnvelope {
  args?: unknown[];
}

function argsOf(payload: unknown): unknown[] {
  return (payload as ArgsEnvelope | undefined)?.args ?? [];
}

function repositoryStatus(baseDirectory: string) {
  const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
  const unavailableReason = validateRepositoryRoot(repositoryRoot);
  return {
    repositoryRoot,
    index: unavailableReason ? null : getRepositoryIndex(repositoryRoot),
    watchedRepositoryRoots: getWatchedRepositoryRoots(),
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

export function registerRepositoryIndexRpcHandlers(bridge: Bridge): void {
  bridge.handle('repositoryIndex.status', (payload) => {
    const [baseDirectory] = argsOf(payload) as [string];
    return repositoryStatus(baseDirectory);
  });

  bridge.handle('repositoryIndex.statusForSession', (payload) => {
    const [providerSessionId] = argsOf(payload) as [string];
    const connection = getRegisteredConnectionBySessionId(providerSessionId);
    const baseDirectory = connection?.baseDirectory;
    if (!baseDirectory) {
      return {
        repositoryRoot: '',
        index: null,
        watchedRepositoryRoots: getWatchedRepositoryRoots(),
        unavailableReason: 'No baseDirectory is registered for this session.',
      };
    }
    return repositoryStatus(baseDirectory);
  });

  bridge.handle('repositoryIndex.index', async (payload) => {
    const [baseDirectory, watch] = argsOf(payload) as [string, boolean];
    const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
    const watcherError = watch ? ensureRepositoryWatcher(repositoryRoot) : null;
    if (watcherError) throw new Error(watcherError);
    return indexRepository(repositoryRoot, { watcherEnabled: watch });
  });

  bridge.handle('repositoryIndex.indexForSession', async (payload) => {
    const [providerSessionId, watch] = argsOf(payload) as [string, boolean];
    const connection = getRegisteredConnectionBySessionId(providerSessionId);
    const baseDirectory = connection?.baseDirectory;
    if (!baseDirectory) {
      throw new Error('No baseDirectory is registered for this session.');
    }
    const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
    const watcherError = watch ? ensureRepositoryWatcher(repositoryRoot) : null;
    if (watcherError) throw new Error(watcherError);
    return indexRepository(repositoryRoot, { watcherEnabled: watch });
  });

  bridge.handle('repositoryIndex.stopWatcher', async (payload) => {
    const [baseDirectory] = argsOf(payload) as [string];
    const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
    return {
      repositoryRoot,
      stopped: await stopRepositoryWatcher(repositoryRoot),
    };
  });

  bridge.handle('repositoryIndex.dependencies', (payload) => {
    const [baseDirectory, path] = argsOf(payload) as [string, string];
    const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
    return {
      repositoryRoot,
      path,
      dependencies: getRepositoryDependencies(repositoryRoot, path),
    };
  });

  bridge.handle('repositoryIndex.dependents', (payload) => {
    const [baseDirectory, path] = argsOf(payload) as [string, string];
    const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
    return {
      repositoryRoot,
      path,
      dependents: getRepositoryDependents(repositoryRoot, path),
    };
  });

  bridge.handle('repositoryIndex.blastRadius', (payload) => {
    const [baseDirectory, paths, maxDepth, limit] = argsOf(payload) as [
      string,
      string[],
      number,
      number,
    ];
    const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
    return {
      repositoryRoot,
      paths,
      maxDepth,
      blastRadius: getRepositoryBlastRadius(
        repositoryRoot,
        paths,
        maxDepth,
        limit,
      ),
    };
  });
}
