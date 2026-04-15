import { memo } from 'react';

type RemoveErrorBannerProps = {
  /** Error message to display */
  error: string;
  /** Callback when dismiss button is clicked */
  onDismiss: () => void;
};

/**
 * Displays an error banner when session removal fails.
 */
function RemoveErrorBanner({
  error,
  onDismiss,
}: RemoveErrorBannerProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-error)]/20 bg-[var(--color-error)]/10 text-xs text-[var(--color-error)]">
      <span>{error}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-3 text-[var(--color-error)]/60 hover:text-[var(--color-error)] transition-colors cursor-pointer"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}

export default memo(RemoveErrorBanner);
