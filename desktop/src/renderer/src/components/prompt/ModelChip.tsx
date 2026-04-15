import React, { memo } from 'react';
import type { Model } from '../../hooks/useProviders';

interface ModelChipProps {
  /** Currently selected model */
  currentModel: Model | null;
  /** Currently selected variant/effort level */
  currentVariant?: string | null;
  /** Whether the popover is open */
  isOpen: boolean;
  /** Toggle the popover */
  onClick: () => void;
  /** Whether the chip is disabled */
  disabled?: boolean;
  /** Loading state */
  isLoading?: boolean;
}

/** Provider icon placeholder - can be extended with actual provider icons */
function ProviderIcon(): React.ReactElement {
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
      <circle cx="8" cy="8" r="6" />
      <path d="M5 8h6M8 5v6" />
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

/** Thinking/reasoning icon for models with reasoning capability */
function ThinkingIcon(): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6h.01M10 6h.01M6 10c.5.5 1.5 1 2 1s1.5-.5 2-1" />
    </svg>
  );
}

/** Format model ID for display by removing date and version suffixes */
export function formatModelId(id: string): string {
  // Remove date suffixes (e.g., -20250514)
  const withoutDate = id.replace(/-\d{8}$/, '');
  // Remove version suffixes like -v1, -v2
  const withoutVersion = withoutDate.replace(/-v\d+$/, '');
  return withoutVersion;
}

function ModelChip({
  currentModel,
  currentVariant,
  isOpen,
  onClick,
  disabled = false,
  isLoading = false,
}: ModelChipProps): React.ReactElement {
  // Loading state
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text-faint)] select-none">
        <ProviderIcon />
        <span className="animate-pulse">loading...</span>
      </span>
    );
  }

  // Format display text
  const displayText = currentModel
    ? formatModelId(currentModel.id)
    : 'Select model';

  // Build tooltip
  const tooltip = currentModel
    ? `Model: ${currentModel.name} (${currentModel.providerName})${currentVariant ? ` - ${currentVariant}` : ''}`
    : 'Select model';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border select-none max-w-[180px] transition-colors ${
        disabled
          ? 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text-faint)] cursor-not-allowed'
          : isOpen
            ? 'bg-[var(--color-agent)]/20 border-[var(--color-agent)]/40 text-[var(--color-agent)]'
            : 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-agent)]/40 hover:text-[var(--color-agent)] cursor-pointer'
      }`}
      title={tooltip}
    >
      <ProviderIcon />
      <span className="truncate">{displayText}</span>
      {currentModel?.reasoning && <ThinkingIcon />}
      <ChevronIcon open={isOpen} />
    </button>
  );
}

export default memo(ModelChip);
