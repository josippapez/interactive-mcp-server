import chokidar, { type FSWatcher } from 'chokidar';
import { normalizeRepositoryRoot, isIgnoredRepositoryPath } from './path-utils';
import {
  deleteChangedPath,
  indexChangedPath,
  validateRepositoryRoot,
} from './indexer';
import {
  drainWatcherChanges,
  enqueueWatcherChange,
  type WatcherChange,
  type WatcherQueueState,
} from './watcher-queue';

const watchers = new Map<string, FSWatcher>();
const pendingTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 750;
const BATCH_SIZE = 5;
const YIELD_MS = 25;
const queueState: WatcherQueueState = {
  pending: new Map(),
  running: false,
  scheduled: false,
};

export function ensureRepositoryWatcher(repositoryRoot: string): string | null {
  const root = normalizeRepositoryRoot(repositoryRoot);
  const validationError = validateRepositoryRoot(root);
  if (validationError) return validationError;
  if (watchers.has(root)) return null;

  const watcher = chokidar.watch(root, {
    ignored: (path) => isIgnoredRepositoryPath(path),
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('add', (path) => schedule('change', root, path));
  watcher.on('change', (path) => schedule('change', root, path));
  watcher.on('unlink', (path) => schedule('delete', root, path));
  watchers.set(root, watcher);
  return null;
}

export async function stopRepositoryWatcher(
  repositoryRoot: string,
): Promise<boolean> {
  const root = normalizeRepositoryRoot(repositoryRoot);
  const watcher = watchers.get(root);
  if (!watcher) return false;
  watchers.delete(root);
  await watcher.close();
  return true;
}

export async function stopAllRepositoryWatchers(): Promise<void> {
  const active = [...watchers.values()];
  watchers.clear();
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
  queueState.pending.clear();
  queueState.running = false;
  queueState.scheduled = false;
  await Promise.all(active.map((watcher) => watcher.close()));
}

export function getWatchedRepositoryRoots(): string[] {
  return [...watchers.keys()].sort();
}

function schedule(
  action: 'change' | 'delete',
  repositoryRoot: string,
  path: string,
): void {
  const key = `${repositoryRoot}:${path}`;
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      enqueueWatcherChange(queueState, { action, repositoryRoot, path });
      scheduleDrain();
    }, DEBOUNCE_MS),
  );
}

function scheduleDrain(): void {
  if (queueState.running || queueState.scheduled) return;
  queueState.scheduled = true;
  setTimeout(() => {
    queueState.scheduled = false;
    void drainQueue();
  }, 0);
}

async function drainQueue(): Promise<void> {
  if (queueState.running) return;
  queueState.running = true;
  try {
    while (queueState.pending.size > 0) {
      const batch = drainWatcherChanges(queueState, BATCH_SIZE);
      for (const change of batch) {
        await processChange(change);
      }
      if (queueState.pending.size > 0) {
        await sleep(YIELD_MS);
      }
    }
  } finally {
    queueState.running = false;
    if (queueState.pending.size > 0) scheduleDrain();
  }
}

async function processChange(change: WatcherChange): Promise<void> {
  try {
    if (change.action === 'delete') {
      deleteChangedPath(change.repositoryRoot, change.path);
      return;
    }
    await indexChangedPath(change.repositoryRoot, change.path);
  } catch (error) {
    console.warn(
      '[repository-index-watcher] failed to process change:',
      error instanceof Error ? error.message : error,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const _resetRepositoryWatchersForTests = stopAllRepositoryWatchers;
