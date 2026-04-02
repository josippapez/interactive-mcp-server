import React from 'react';

type Props = {
  label: string;
  promptActive: boolean;
  onClearMessages: () => void;
  onRemoveSession: () => void;
  onDismissSession: () => void;
};

export default function ChannelHeader({
  label,
  promptActive,
  onClearMessages,
  onRemoveSession,
  onDismissSession,
}: Props): React.ReactElement {
  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[var(--color-text-faint)]">#</span>
        <h2 className="text-sm text-[var(--color-text)] truncate">{label}</h2>
        {promptActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-user)]/10 text-[var(--color-user)]">
            pending prompt
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onClearMessages}
          className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          title="Clear Q/A history and unsent queued messages"
        >
          Clear messages
        </button>
        <button
          onClick={onDismissSession}
          className="px-2 py-1 text-xs rounded-sm border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          title="Close tab from UI"
        >
          Close tab
        </button>
        <button
          onClick={onRemoveSession}
          className="px-2 py-1 text-xs rounded-sm border border-[var(--color-error)]/60 text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
          title="Remove session channel and terminate if active"
        >
          Remove session
        </button>
      </div>
    </header>
  );
}
