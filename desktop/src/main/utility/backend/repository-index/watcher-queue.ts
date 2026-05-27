export type WatcherChangeAction = 'change' | 'delete';

export type WatcherChange = {
  action: WatcherChangeAction;
  repositoryRoot: string;
  path: string;
};

export type WatcherQueueState = {
  pending: Map<string, WatcherChange>;
  running: boolean;
  scheduled: boolean;
};

export function getWatcherChangeKey(change: WatcherChange): string {
  return `${change.repositoryRoot}:${change.path}`;
}

export function enqueueWatcherChange(
  state: WatcherQueueState,
  change: WatcherChange,
): void {
  state.pending.set(getWatcherChangeKey(change), change);
}

export function drainWatcherChanges(
  state: WatcherQueueState,
  limit: number,
): WatcherChange[] {
  const changes: WatcherChange[] = [];
  for (const [key, change] of state.pending) {
    state.pending.delete(key);
    changes.push(change);
    if (changes.length >= limit) break;
  }
  return changes;
}
