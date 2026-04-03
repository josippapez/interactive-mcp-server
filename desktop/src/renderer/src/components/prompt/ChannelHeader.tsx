import React from 'react';

type Props = {
  label: string;
  promptActive: boolean;
  onClearMessages: () => void;
  onRemoveSession: () => void;
  onDismissSession: () => void;
};

const iconBtn =
  'w-7 h-7 flex items-center justify-center rounded-sm text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors cursor-pointer';

const iconBtnDanger =
  'w-7 h-7 flex items-center justify-center rounded-sm text-[var(--color-error)]/60 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors cursor-pointer';

export default function ChannelHeader({
  label,
  promptActive,
  onClearMessages,
  onRemoveSession,
  onDismissSession,
}: Props): React.ReactElement {
  return (
    <header className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[var(--color-text-faint)] select-none">#</span>
        <h2 className="text-sm text-[var(--color-text)] truncate">{label}</h2>
        {promptActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--color-user)]/10 text-[var(--color-user)] select-none">
            pending prompt
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onClearMessages}
          className={iconBtn}
          title="Clear message history"
        >
          {/* eraser-ish: lines with strike */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 13h12" />
            <path d="M4 10 9 3l4 3-5 7H4z" />
            <path d="M9 3l4 3" />
          </svg>
        </button>
        <button
          onClick={onDismissSession}
          className={iconBtn}
          title="Close tab from UI"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M3 3l10 10M13 3 3 13" />
          </svg>
        </button>
        <button
          onClick={onRemoveSession}
          className={iconBtnDanger}
          title="Remove session channel permanently"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4h10" />
            <path d="M6 4V2h4v2" />
            <path d="M5 4l.5 9h5l.5-9" />
            <path d="M7 7v4M9 7v4" />
          </svg>
        </button>
      </div>
    </header>
  );
}
