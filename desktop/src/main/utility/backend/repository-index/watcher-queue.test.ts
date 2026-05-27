import { describe, expect, it } from 'vitest';
import {
  drainWatcherChanges,
  enqueueWatcherChange,
  type WatcherQueueState,
} from './watcher-queue';

describe('enqueueWatcherChange', () => {
  it('coalesces repeated events for the same path', () => {
    const state: WatcherQueueState = {
      pending: new Map(),
      running: false,
      scheduled: false,
    };

    enqueueWatcherChange(state, {
      action: 'change',
      repositoryRoot: '/repo',
      path: '/repo/src/a.ts',
    });
    enqueueWatcherChange(state, {
      action: 'change',
      repositoryRoot: '/repo',
      path: '/repo/src/a.ts',
    });

    expect(state.pending.size).toBe(1);
    expect(state.pending.get('/repo:/repo/src/a.ts')?.action).toBe('change');
  });

  it('lets delete override a pending change for the same path', () => {
    const state: WatcherQueueState = {
      pending: new Map(),
      running: false,
      scheduled: false,
    };

    enqueueWatcherChange(state, {
      action: 'change',
      repositoryRoot: '/repo',
      path: '/repo/src/a.ts',
    });
    enqueueWatcherChange(state, {
      action: 'delete',
      repositoryRoot: '/repo',
      path: '/repo/src/a.ts',
    });

    expect(state.pending.get('/repo:/repo/src/a.ts')?.action).toBe('delete');
  });

  it('drains a limited batch and leaves the rest queued', () => {
    const state: WatcherQueueState = {
      pending: new Map(),
      running: false,
      scheduled: false,
    };

    enqueueWatcherChange(state, {
      action: 'change',
      repositoryRoot: '/repo',
      path: '/repo/src/a.ts',
    });
    enqueueWatcherChange(state, {
      action: 'change',
      repositoryRoot: '/repo',
      path: '/repo/src/b.ts',
    });

    expect(drainWatcherChanges(state, 1)).toHaveLength(1);
    expect(state.pending.size).toBe(1);
  });
});
