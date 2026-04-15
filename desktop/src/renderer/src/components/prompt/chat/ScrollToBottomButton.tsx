import React, { memo } from 'react';

interface ScrollToBottomButtonProps {
  visible: boolean;
  unreadCount: number;
  onClick: () => void;
}

/**
 * Scroll-to-bottom button with animation, unread count, and keyboard shortcut hint.
 * Shows when user scrolls away from bottom.
 */
const ScrollToBottomButton = memo(function ScrollToBottomButton({
  visible,
  unreadCount,
  onClick,
}: ScrollToBottomButtonProps): React.ReactElement {
  // Always render for animation but control visibility with opacity/transform
  return (
    <button
      type="button"
      onClick={onClick}
      data-scroll-to-bottom
      className={`
        absolute bottom-4 left-1/2 -translate-x-1/2 z-10
        flex items-center gap-1.5 px-3 py-1.5
        text-xs font-medium rounded-full
        bg-[var(--color-surface)] border border-[var(--color-border)]
        text-[var(--color-text-muted)] shadow-lg
        hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]
        hover:border-[var(--color-agent)]
        transition-all duration-200 ease-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}
      `}
      aria-label="Scroll to bottom"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
          clipRule="evenodd"
        />
      </svg>
      {unreadCount > 0 ? (
        <span>
          {unreadCount} new message{unreadCount !== 1 ? 's' : ''}
        </span>
      ) : (
        <span>Jump to bottom</span>
      )}
      <kbd className="ml-1 px-1 py-0.5 rounded text-[9px] bg-[var(--color-border)] text-[var(--color-text-faint)]">
        End
      </kbd>
    </button>
  );
});

export default ScrollToBottomButton;
