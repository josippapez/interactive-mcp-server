import React, { useState } from 'react';
import ProviderAuthModal from './ProviderAuthModal';

interface ProviderAuthButtonProps {
  /** The provider ID to authenticate. */
  providerId: string;
  /** The provider display name. */
  providerName: string;
  /** Optional button variant. */
  variant?: 'default' | 'compact' | 'inline';
  /** Called when auth succeeds. */
  onSuccess?: () => void;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * Button that opens the provider auth modal when clicked.
 *
 * Variants:
 * - default: Standard button with icon and text
 * - compact: Smaller button for tight spaces
 * - inline: Text-only link style
 */
export default function ProviderAuthButton({
  providerId,
  providerName,
  variant = 'default',
  onSuccess,
  className = '',
}: ProviderAuthButtonProps): React.ReactElement {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSuccess = () => {
    setIsModalOpen(false);
    onSuccess?.();
  };

  const baseStyles = {
    default:
      'flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] text-sm hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)] transition-colors',
    compact:
      'flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] text-xs hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)] transition-colors',
    inline:
      'text-[var(--color-agent)] text-sm hover:underline hover:opacity-80 transition-opacity',
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className={`${baseStyles[variant]} ${className}`}
        aria-label={`Connect ${providerName}`}
      >
        {variant !== 'inline' && (
          <svg
            className={variant === 'compact' ? 'h-3 w-3' : 'h-4 w-4'}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        )}
        <span>Connect{variant === 'inline' ? ` ${providerName}` : ''}</span>
      </button>

      <ProviderAuthModal
        providerId={providerId}
        providerName={providerName}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSuccess}
      />
    </>
  );
}
