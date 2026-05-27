import { describe, expect, it } from 'vitest';
import { deriveRepositoryIndexViewState } from './repository-index-view-state';

describe('deriveRepositoryIndexViewState', () => {
  it('returns unavailable when there is no repository context', () => {
    expect(
      deriveRepositoryIndexViewState({
        enabled: false,
        loading: false,
        error: null,
        data: null,
      }),
    ).toBe('unavailable');
  });

  it('returns unavailable when the selected folder is not indexable', () => {
    expect(
      deriveRepositoryIndexViewState({
        enabled: true,
        loading: false,
        error: null,
        data: {
          repositoryRoot: '/Users/example/Desktop',
          watchedRepositoryRoots: [],
          index: null,
          unavailableReason: 'Selected folder is not a git repository.',
        },
      }),
    ).toBe('unavailable');
  });

  it('returns ready when the index is ready', () => {
    expect(
      deriveRepositoryIndexViewState({
        enabled: true,
        loading: false,
        error: null,
        data: {
          repositoryRoot: '/repo',
          watchedRepositoryRoots: [],
          index: {
            repositoryRoot: '/repo',
            status: 'ready',
            fileCount: 10,
            edgeCount: 12,
            indexedFileCount: 10,
            startedAt: null,
            completedAt: null,
            lastError: null,
            indexVersion: 1,
            watcherEnabled: true,
            updatedAt: 'now',
          },
        },
      }),
    ).toBe('ready');
  });
});
