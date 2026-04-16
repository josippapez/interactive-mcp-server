import { memo } from 'react';
import type { SessionStatus } from '../../../types';
import { StatusDot } from './StatusDot';
import { STATUS_COLORS } from './constants';

type StatusDisplayProps = {
  isBusy: boolean;
  latestStatus: SessionStatus | undefined;
  connectionId: string | null | undefined;
  onDismissStatus:
    | ((connectionId: string, timestamp: Date) => void)
    | undefined;
  sendShortcut: string;
};

/** Center area displaying status or keyboard hint */
function StatusDisplayComponent({
  isBusy: _isBusy, // No longer used - busy indicator moved to ContextUsageBar
  latestStatus,
  connectionId,
  onDismissStatus,
  sendShortcut,
}: StatusDisplayProps): React.ReactElement {
  // Only show explicit status messages from agents (not the generic busy state)
  if (latestStatus) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] min-w-0">
        <StatusDot type={latestStatus.type} />
        <span
          className="truncate"
          style={{
            color: STATUS_COLORS[latestStatus.type] ?? STATUS_COLORS.info,
          }}
        >
          {latestStatus.status}
        </span>
        {connectionId && onDismissStatus && (
          <button
            type="button"
            onClick={() =>
              onDismissStatus(connectionId, latestStatus.timestamp)
            }
            className="ml-0.5 shrink-0 opacity-50 hover:opacity-100 transition-opacity text-[var(--color-text-muted)]"
            title="Dismiss"
            aria-label="Dismiss status"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-[var(--color-text-faint)] select-none">
      <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-kbd-bg)] font-mono">
        {sendShortcut}
      </kbd>
      <span>to send</span>
    </span>
  );
}

export const StatusDisplay = memo(StatusDisplayComponent);
