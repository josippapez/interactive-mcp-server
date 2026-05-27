import { Database, GitBranch, RefreshCw } from 'lucide-react';
import type { RepositoryIndexStatusPayload } from '../../../../preload/api/types';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';

type Props = {
  state: 'loading' | 'indexing' | 'error' | 'not-indexed' | 'disabled';
  data: RepositoryIndexStatusPayload | null;
  error: string | null;
  onRetry: () => void;
  onContinue: () => void;
};

export default function RepositoryIndexingView({
  state,
  data,
  error,
  onRetry,
  onContinue,
}: Props): React.ReactElement {
  const index = data?.index ?? null;
  const isWorking = state === 'loading' || state === 'indexing';
  const percentage =
    index && index.fileCount > 0
      ? Math.min(
          100,
          Math.round((index.indexedFileCount / index.fileCount) * 100),
        )
      : null;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--color-surface)] px-6">
      <section
        aria-live="polite"
        className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-alt)]/80 p-8 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[var(--color-agent)]/12 text-[var(--color-agent)]">
            {isWorking ? (
              <Spinner className="size-5" />
            ) : (
              <Database size={20} aria-hidden="true" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Indexing repository
              {percentage !== null ? ` (${percentage}%)` : ''}
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Building a dependency graph for blast-radius analysis.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
          <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
            <GitBranch size={14} aria-hidden="true" />
            <span className="truncate">
              {data?.repositoryRoot ?? 'Preparing repository...'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="Files" value={index?.fileCount ?? 0} />
            <Metric label="Indexed" value={index?.indexedFileCount ?? 0} />
            <Metric label="Edges" value={index?.edgeCount ?? 0} />
          </div>
          {percentage !== null && (
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)]"
              aria-label={`Repository indexing ${percentage}% complete`}
            >
              <div
                className="h-full rounded-full bg-[var(--color-agent)] transition-[width]"
                style={{ width: `${percentage}%` }}
              />
            </div>
          )}
          {error || index?.lastError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
              {error ?? index?.lastError}
            </p>
          ) : (
            <p className="text-[var(--color-text-muted)]">
              You can continue without waiting, but blast-radius tools work best
              after indexing completes.
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onContinue}>
            Continue without index
          </Button>
          <Button type="button" onClick={onRetry} disabled={isWorking}>
            {isWorking ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            {state === 'error' ? 'Retry indexing' : 'Refresh index'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-alt)] px-3 py-2">
      <div className="text-base font-semibold text-[var(--color-text)]">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
    </div>
  );
}
