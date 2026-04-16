import {
  useContextUsage,
  type ContextUsage,
} from '../../hooks/useContextUsage';

interface ContextUsageBarProps {
  sessionId: string | null;
  /** When provided, overrides the cached contextLimit from the hook */
  modelContextWindow?: number;
  /** Whether the session is currently busy (agent running) */
  isBusy?: boolean;
}

const MAX_PROGRESS_PERCENT = 100;
const PERCENT_DECIMALS = 1;

/**
 * Format token count for display.
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function formatPercent(value: number): string {
  return `${value.toFixed(PERCENT_DECIMALS)}%`;
}

/**
 * Get color class based on usage percentage.
 */
function getUsageColor(usage: ContextUsage | null): string {
  if (!usage) return 'bg-[var(--color-text-muted)]';
  if (usage.isOverflow) return 'bg-[var(--color-error,#ef4444)]';
  if (usage.isNearOverflow) return 'bg-[var(--color-warning,#f59e0b)]';
  if (usage.usagePercent >= 50) return 'bg-[var(--color-info,#3b82f6)]';
  return 'bg-[var(--color-success,#22c55e)]';
}

/**
 * Animated spinner icon for busy state.
 */
function BusySpinner(): React.ReactElement {
  return (
    <svg
      className="animate-spin h-3 w-3 text-[var(--color-agent)]"
      viewBox="0 0 16 16"
      fill="none"
      aria-label="Agent busy"
    >
      <title>Agent busy</title>
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Context usage indicator bar component.
 *
 * Shows a progress bar of token usage with:
 * - Green: 0-49% usage
 * - Blue: 50-79% usage
 * - Yellow: 80-99% usage (near overflow)
 * - Red: 100%+ usage (overflow)
 *
 * Clicking the bar when at 80%+ usage triggers compaction.
 */
export function ContextUsageBar({
  sessionId,
  modelContextWindow,
  isBusy,
}: ContextUsageBarProps) {
  const { usage, compactionStatus, compactionError, compact } =
    useContextUsage(sessionId);

  if (!usage) {
    return null;
  }

  const showCompactButton = usage.isNearOverflow || usage.isOverflow;
  const isCompacting = compactionStatus === 'compacting';
  const usageColor = getUsageColor(usage);
  // Use modelContextWindow if provided, otherwise fall back to cached contextLimit
  const effectiveContextLimit = modelContextWindow ?? usage.contextLimit;
  const percentUsedOfMax = (usage.totalTokens / effectiveContextLimit) * 100;
  const widthPercent = Math.min(MAX_PROGRESS_PERCENT, percentUsedOfMax);
  const usageLabel = `Context ${formatTokens(usage.totalTokens)} / ${formatTokens(effectiveContextLimit)} (${formatPercent(percentUsedOfMax)})`;

  return (
    <div className="flex items-center gap-2">
      {/* Busy spinner when agent is running */}
      {isBusy && <BusySpinner />}

      {/* Progress bar */}
      <div
        className="relative w-20 h-2 rounded-full bg-[var(--color-border)] overflow-hidden"
        title={usageLabel}
      >
        <div
          className={`absolute inset-y-0 left-0 ${usageColor} transition-all duration-300`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>

      {/* Usage label */}
      <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
        {usageLabel}
      </span>

      {/* Compact button (when near/over limit) */}
      {showCompactButton && (
        <button
          type="button"
          onClick={compact}
          disabled={isCompacting}
          className={`
            text-[10px] px-1.5 py-0.5 rounded
            ${
              isCompacting
                ? 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-wait'
                : 'bg-[var(--color-warning,#f59e0b)] text-white hover:bg-[var(--color-warning,#f59e0b)]/80'
            }
            transition-colors
          `}
          title={
            isCompacting
              ? 'Compacting...'
              : 'Summarize context to free up tokens'
          }
        >
          {isCompacting ? '⏳' : '⚡'}
        </button>
      )}

      {/* Error indicator */}
      {compactionError && (
        <span
          className="text-[10px] text-[var(--color-error,#ef4444)]"
          title={compactionError}
        >
          ⚠️
        </span>
      )}
    </div>
  );
}

/**
 * Context overflow alert banner.
 *
 * Shows a warning banner when context usage exceeds 80%.
 * Provides a button to trigger compaction.
 */
export function ContextOverflowAlert({ sessionId }: ContextUsageBarProps) {
  const { usage, compactionStatus, compactionError, compact } =
    useContextUsage(sessionId);

  if (!usage || (!usage.isNearOverflow && !usage.isOverflow)) {
    return null;
  }

  const isCompacting = compactionStatus === 'compacting';
  const isOverflow = usage.isOverflow;

  return (
    <div
      className={`
        flex items-center justify-between gap-3 px-3 py-2 text-sm
        ${
          isOverflow
            ? 'bg-[var(--color-error,#ef4444)]/10 border-[var(--color-error,#ef4444)]'
            : 'bg-[var(--color-warning,#f59e0b)]/10 border-[var(--color-warning,#f59e0b)]'
        }
        border-l-4
      `}
    >
      <div className="flex items-center gap-2">
        <span>{isOverflow ? '🔴' : '🟡'}</span>
        <span className="text-[var(--color-text)]">
          {isOverflow
            ? `Context limit exceeded (${usage.usagePercent}%)`
            : `Approaching context limit (${usage.usagePercent}%)`}
        </span>
        <span className="text-[var(--color-text-muted)] text-xs">
          {formatTokens(usage.totalTokens)} / {formatTokens(usage.usableLimit)}{' '}
          tokens
        </span>
      </div>

      <button
        type="button"
        onClick={compact}
        disabled={isCompacting}
        className={`
          text-xs px-3 py-1 rounded font-medium
          ${
            isCompacting
              ? 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-wait'
              : isOverflow
                ? 'bg-[var(--color-error,#ef4444)] text-white hover:bg-[var(--color-error,#ef4444)]/80'
                : 'bg-[var(--color-warning,#f59e0b)] text-white hover:bg-[var(--color-warning,#f59e0b)]/80'
          }
          transition-colors
        `}
      >
        {isCompacting ? 'Compacting...' : 'Compact Now'}
      </button>

      {compactionError && (
        <span className="text-xs text-[var(--color-error,#ef4444)]">
          {compactionError}
        </span>
      )}
    </div>
  );
}
