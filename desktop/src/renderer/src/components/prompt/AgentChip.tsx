import React, { memo } from 'react';

interface AgentChipProps {
  /** Currently selected agent name, or null for the default agent */
  selectedAgent: string | null;
  /** Whether the popover is open */
  isOpen: boolean;
  /** Toggle the popover */
  onClick: () => void;
  /** Whether the chip is disabled */
  disabled?: boolean;
}

/** Bot/agent icon */
function AgentIcon(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <rect x="3" y="5" width="10" height="8" rx="1.5" />
      <path d="M8 2v3M6 8.5h.01M10 8.5h.01M6 11h4" />
    </svg>
  );
}

/** Chevron icon */
function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function AgentChip({
  selectedAgent,
  isOpen,
  onClick,
  disabled = false,
}: AgentChipProps): React.ReactElement {
  const displayText = selectedAgent ?? 'default';
  const tooltip = selectedAgent
    ? `Agent: ${selectedAgent}`
    : 'Agent: default (no custom agent)';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tooltip}
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border select-none max-w-[180px] transition-colors ${
        disabled
          ? 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text-faint)] cursor-not-allowed'
          : isOpen
            ? 'bg-[var(--color-agent)]/20 border-[var(--color-agent)]/40 text-[var(--color-agent)]'
            : 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-agent)]/40 hover:text-[var(--color-agent)] cursor-pointer'
      }`}
      title={tooltip}
    >
      <AgentIcon />
      <span className="truncate">{displayText}</span>
      <ChevronIcon open={isOpen} />
    </button>
  );
}

export default memo(AgentChip);
