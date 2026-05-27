import { describe, expect, it, vi } from 'vitest';
import type { RepositoryIndexRecord } from './types';
import { startMissingRepositoryIndexes } from './autostart';

describe('startMissingRepositoryIndexes', () => {
  it('indexes only base directories that have not already been indexed', async () => {
    const indexed: string[] = [];
    const readyIndex = makeIndex('/repo-a');

    await startMissingRepositoryIndexes(['/repo-a', '/repo-b', '/repo-b', ''], {
      getIndex: (root) => (root === '/repo-a' ? readyIndex : null),
      indexRepository: async (root) => {
        indexed.push(root);
        return {
          status: makeIndex(root),
          filesIndexed: 1,
          edgesIndexed: 0,
        };
      },
      validateRepositoryRoot: () => null,
      ensureWatcher: () => null,
      normalizeRepositoryRoot: (root) => root,
    });

    expect(indexed).toEqual(['/repo-b']);
  });

  it('does not start indexing when indexing is disabled', async () => {
    const indexRepository = vi.fn();

    await startMissingRepositoryIndexes(['/repo'], {
      enabled: false,
      getIndex: () => null,
      indexRepository,
      validateRepositoryRoot: () => null,
      ensureWatcher: () => null,
      normalizeRepositoryRoot: (root) => root,
    });

    expect(indexRepository).not.toHaveBeenCalled();
  });
});

function makeIndex(repositoryRoot: string): RepositoryIndexRecord {
  return {
    repositoryRoot,
    status: 'ready',
    fileCount: 1,
    edgeCount: 0,
    indexedFileCount: 1,
    startedAt: null,
    completedAt: null,
    lastError: null,
    indexVersion: 1,
    watcherEnabled: true,
    updatedAt: 'now',
  };
}
