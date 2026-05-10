import React, { memo, useMemo, useState } from 'react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverPositioner,
} from '../ui/popover';
import {
  formatReasoningVariant,
  normalizeReasoningVariant,
  normalizeReasoningVariants,
} from '../../../../shared/reasoning-variant';

interface VariantSelectorProps {
  /** Available variants for the current model */
  variants: string[];
  /** Currently selected variant (null = default) */
  currentVariant?: string | null;
  /** Callback when a variant is selected */
  onSelectVariant: (variant: string | undefined) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
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

/** Effort/thinking icon */
function EffortIcon(): React.ReactElement {
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
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}

function VariantSelector({
  variants,
  currentVariant,
  onSelectVariant,
  disabled = false,
}: VariantSelectorProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const normalizedCurrentVariant = normalizeReasoningVariant(currentVariant);
  const effectiveVariants = useMemo(
    () =>
      normalizeReasoningVariants([
        ...variants,
        ...(normalizedCurrentVariant ? [normalizedCurrentVariant] : []),
      ]) ?? [],
    [variants, normalizedCurrentVariant],
  );

  // All hooks must be called before any early returns
  const hasVariants = effectiveVariants.length > 0;

  // Don't render if no variants available
  if (!hasVariants) {
    return null;
  }

  const handleSelect = (variant: string | undefined) => {
    onSelectVariant(variant);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border select-none transition-colors ${
              disabled
                ? 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text-faint)] cursor-not-allowed'
                : open
                  ? 'bg-[var(--color-agent)]/20 border-[var(--color-agent)]/40 text-[var(--color-agent)]'
                  : 'bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-agent)]/40 hover:text-[var(--color-agent)] cursor-pointer'
            }`}
            title={`Effort level: ${formatReasoningVariant(normalizedCurrentVariant)}`}
          >
            <EffortIcon />
            <span>{formatReasoningVariant(normalizedCurrentVariant)}</span>
            <ChevronIcon open={open} />
          </button>
        }
      />

      <PopoverPositioner side="top" align="start" sideOffset={4}>
        <PopoverContent className="min-w-[100px] p-1">
          {/* Default option */}
          <button
            type="button"
            onClick={() => handleSelect(undefined)}
            className={`w-full px-3 py-1.5 text-left text-[11px] rounded-sm transition-colors ${
              !normalizedCurrentVariant
                ? 'bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            Default
          </button>
          {/* Variant options */}
          {effectiveVariants.map((variant) => (
            <button
              key={variant}
              type="button"
              onClick={() => handleSelect(variant)}
              className={`w-full px-3 py-1.5 text-left text-[11px] rounded-sm transition-colors ${
                normalizedCurrentVariant === variant
                  ? 'bg-[var(--color-agent)]/10 text-[var(--color-agent)]'
                  : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
              }`}
            >
              {formatReasoningVariant(variant)}
            </button>
          ))}
        </PopoverContent>
      </PopoverPositioner>
    </Popover>
  );
}

function areVariantsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

export default memo(VariantSelector, (prev, next) => {
  return (
    prev.disabled === next.disabled &&
    prev.currentVariant === next.currentVariant &&
    prev.onSelectVariant === next.onSelectVariant &&
    areVariantsEqual(prev.variants, next.variants)
  );
});
