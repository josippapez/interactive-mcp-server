import { AlertTriangle, Database } from 'lucide-react';
import { useState } from 'react';
import type { RepositoryIndexStatusPayload } from '../../../../../preload/api/types';
import type { RepositoryIndexViewState } from '../../../hooks/repository-index-view-state';
import { useRepositoryIndexStatus } from '../../../hooks/useRepositoryIndexStatus';
import {
  Popover,
  PopoverContent,
  PopoverPositioner,
  PopoverTrigger,
} from '../../ui/popover';
import { Spinner } from '../../ui/spinner';

type Props = {
  baseDirectory?: string | null;
  providerSessionId: string | null | undefined;
};

type TitleArgs = {
  viewState: RepositoryIndexViewState;
  data: RepositoryIndexStatusPayload | null;
  error: string | null;
};

export function RepositoryIndexBadge({
  baseDirectory,
  providerSessionId,
}: Props): React.ReactElement | null {
  const repositoryIndex = useRepositoryIndexStatus(
    baseDirectory ?? null,
    providerSessionId ?? null,
  );
  if (!baseDirectory && !providerSessionId) return null;

  return (
    <RepositoryIndexBadgeContent
      viewState={repositoryIndex.viewState}
      data={repositoryIndex.data}
      error={repositoryIndex.error}
      loading={repositoryIndex.loading}
      onTrigger={repositoryIndex.startIndexing}
      onStopWatcher={repositoryIndex.stopWatcher}
      stoppingWatcher={repositoryIndex.isStoppingWatcher}
    />
  );
}

function RepositoryIndexBadgeContent({
  viewState,
  data,
  error,
  loading,
  onTrigger,
  onStopWatcher,
  stoppingWatcher,
}: {
  viewState: RepositoryIndexViewState;
  data: RepositoryIndexStatusPayload | null;
  error: string | null;
  loading: boolean;
  onTrigger: (() => void) | undefined;
  onStopWatcher: (() => Promise<boolean>) | undefined;
  stoppingWatcher: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const isWorking =
    loading || viewState === 'loading' || viewState === 'indexing';
  const isReady = viewState === 'ready';
  const isError = viewState === 'error';
  const isWatcherRunning = Boolean(
    data?.repositoryRoot &&
    data.watchedRepositoryRoots.includes(data.repositoryRoot),
  );
  const percentage = getIndexPercentage(data);

  const title = `${getTitle({ viewState, data, error })}. Open repository index actions.`;

  const handleStopWatcher = async () => {
    if (!onStopWatcher) return;
    await onStopWatcher();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={title}
            aria-label={title}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors ${
              isReady
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                : isError
                  ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15'
                  : 'border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-agent)_10%,transparent)] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--color-agent)_15%,transparent)]'
            }`}
          >
            {isWorking ? (
              <Spinner className="size-3" />
            ) : isError ? (
              <AlertTriangle size={12} aria-hidden="true" />
            ) : (
              <Database size={12} aria-hidden="true" />
            )}
            <span className="whitespace-nowrap">
              {getLabel(viewState, percentage)}
            </span>
          </button>
        }
      />

      <PopoverPositioner side="top" align="start" sideOffset={4}>
        <PopoverContent className="w-64 p-2">
          <div className="px-2 py-1.5">
            <div className="text-xs font-medium text-[var(--color-text)]">
              Repository Index
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {getTitle({ viewState, data, error })}
            </div>
          </div>
          <div className="mt-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                onTrigger?.();
                setOpen(false);
              }}
              disabled={!onTrigger || isWorking}
              className="rounded px-2 py-1.5 text-left text-[11px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start indexing
            </button>
            <button
              type="button"
              onClick={() => {
                void handleStopWatcher();
              }}
              disabled={!onStopWatcher || !isWatcherRunning || stoppingWatcher}
              className="rounded px-2 py-1.5 text-left text-[11px] text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stoppingWatcher ? 'Stopping watcher...' : 'Stop watcher'}
            </button>
          </div>
        </PopoverContent>
      </PopoverPositioner>
    </Popover>
  );
}

function getIndexPercentage(
  data: RepositoryIndexStatusPayload | null,
): number | null {
  const index = data?.index;
  if (!index || index.fileCount <= 0) return null;
  return Math.min(
    100,
    Math.round((index.indexedFileCount / index.fileCount) * 100),
  );
}

function getLabel(
  viewState: RepositoryIndexViewState,
  percentage: number | null,
): string {
  if (viewState === 'ready') return 'Indexed';
  if (viewState === 'indexing' || viewState === 'loading') {
    return percentage === null ? 'Indexing' : `Indexing ${percentage}%`;
  }
  if (viewState === 'error') return 'Index error';
  if (viewState === 'disabled') return 'Index off';
  if (viewState === 'unavailable') return 'Index unavailable';
  return 'Not indexed';
}

function getTitle({ viewState, data, error }: TitleArgs): string {
  const index = data?.index ?? null;
  const details = index
    ? `${index.fileCount.toLocaleString()} files, ${index.edgeCount.toLocaleString()} dependency edges`
    : 'No repository dependency graph yet';
  if (viewState === 'error') {
    return `Repository index error: ${error ?? index?.lastError ?? 'Unknown error'}`;
  }
  if (viewState === 'disabled') return 'Repository indexing is disabled';
  if (viewState === 'unavailable') {
    return 'Repository index unavailable: no repository folder is attached to this session yet';
  }
  if (viewState === 'indexing' || viewState === 'loading') {
    return `Repository indexing in progress. ${details}`;
  }
  if (viewState === 'ready') return `Repository index ready. ${details}`;
  return 'Repository has not been indexed yet';
}
