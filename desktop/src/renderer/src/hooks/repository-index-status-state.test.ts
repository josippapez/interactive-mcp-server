import { describe, expect, it } from 'vitest';
import type { IpcResult } from '../lib/ipc-result';
import type { RepositoryIndexStatusPayload } from '../../../preload/api/types';
import { reduceRepositoryIndexQueryResult } from './repository-index-status-state';

describe('reduceRepositoryIndexQueryResult', () => {
  it('clears stale data when the selected repository key changes', () => {
    const previousData: RepositoryIndexStatusPayload = {
      repositoryRoot: '/repo-a',
      watchedRepositoryRoots: [],
      index: {
        repositoryRoot: '/repo-a',
        status: 'ready',
        fileCount: 10,
        edgeCount: 20,
        indexedFileCount: 10,
        startedAt: null,
        completedAt: null,
        lastError: null,
        indexVersion: 1,
        watcherEnabled: true,
        updatedAt: 'now',
      },
    };
    const result: IpcResult<RepositoryIndexStatusPayload> = {
      ok: true,
      data: {
        repositoryRoot: '/repo-b',
        watchedRepositoryRoots: [],
        index: null,
      },
    };

    const next = reduceRepositoryIndexQueryResult(
      { data: previousData, error: null, key: 'session-a' },
      result,
      'session-b',
    );

    expect(next).toEqual({ data: result.data, error: null, key: 'session-b' });
  });

  it('keeps existing data for manual refetch errors on the same repository key', () => {
    const previousData: RepositoryIndexStatusPayload = {
      repositoryRoot: '/repo-a',
      watchedRepositoryRoots: [],
      index: null,
    };
    const result: IpcResult<RepositoryIndexStatusPayload> = {
      ok: false,
      error: 'Failed to refresh',
    };

    const next = reduceRepositoryIndexQueryResult(
      { data: previousData, error: null, key: 'repo:/repo-a' },
      result,
      'repo:/repo-a',
    );

    expect(next).toEqual({
      data: previousData,
      error: 'Failed to refresh',
      key: 'repo:/repo-a',
    });
  });
});
