import React from 'react';
import type { SessionStatus } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  info: 'var(--color-agent, #5599dd)',
  working: 'var(--color-user, #cc7700)',
  success: 'var(--color-success, #22c55e)',
  error: 'var(--color-error, #cc3333)',
};

type Props = {
  sessionChannel: { sessionId: string; label?: string };
  sessionStatuses: SessionStatus[];
  connectionId: string;
  onDismissStatus: (connectionId: string, timestamp: Date) => void;
};

function StatusDot({ type }: { type: string }): React.ReactElement {
  const colorMap: Record<string, string> = {
    info: 'bg-[var(--color-agent)]',
    working: 'bg-[var(--color-user)]',
    success: 'bg-[var(--color-success)]',
    error: 'bg-[var(--color-error)]',
  };
  const color = colorMap[type] ?? colorMap.info;
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${color} ${type === 'working' ? 'animate-pulse' : ''}`}
    />
  );
}

export default function SessionChannelBar({
  sessionChannel,
  sessionStatuses,
  connectionId,
  onDismissStatus,
}: Props): React.ReactElement {
  const latestStatus = sessionStatuses.at(-1);

  return (
    <div className="border-t shrink-0 border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      <div className="flex items-center gap-1.5 px-3 py-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-agent)] shrink-0" />
        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
          {sessionChannel.label ?? sessionChannel.sessionId}
        </span>
      </div>
      {latestStatus && (
        <div
          className="flex items-center justify-between px-3 py-1 text-xs"
          style={{
            borderTop: '1px solid var(--color-border, #1a1a1a)',
            color: STATUS_COLORS[latestStatus.type] ?? STATUS_COLORS.info,
          }}
        >
          <span className="flex items-center gap-1.5 truncate">
            <StatusDot type={latestStatus.type} />
            <span className="truncate">{latestStatus.status}</span>
          </span>
          <button
            onClick={() =>
              onDismissStatus(connectionId, latestStatus.timestamp)
            }
            className="ml-2 shrink-0 opacity-50 hover:opacity-100 transition-opacity text-[10px]"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
