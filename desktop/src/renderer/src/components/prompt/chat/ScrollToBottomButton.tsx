import React, { memo } from 'react';
import {
  resolveStickyToggleVisuals,
  shouldShowStickyToggle,
} from './sticky-toggle-helpers';

interface ScrollToBottomButtonProps {
  /** Whether the view is currently at the bottom (within threshold). */
  isAtBottom: boolean;
  /** Whether the jump-button distance threshold is exceeded. */
  showJump: boolean;
  /** Current "stick to bottom" preference (drives the toggle state). */
  stickToBottom: boolean;
  /** Number of unread messages while toggle is OFF / not at bottom. */
  unreadCount: number;
  /**
   * Toggle handler.
   *   - Turning ON should also force a scroll to the bottom.
   *   - Turning OFF should leave the scroll position untouched.
   */
  onToggle: (next: boolean) => void;
}

/**
 * Stick-to-bottom toggle (Bug 3).
 *
 * Replaces the old "Jump to bottom" button: when the toggle is ON, new
 * messages auto-scroll the view; when the user manually scrolls away it
 * automatically flips OFF. Clicking the toggle while OFF re-engages
 * stick-to-bottom AND jumps to the latest message.
 */
const ScrollToBottomButton = memo(function ScrollToBottomButton({
  isAtBottom,
  showJump,
  stickToBottom,
  unreadCount,
  onToggle,
}: ScrollToBottomButtonProps): React.ReactElement {
  const visible = shouldShowStickyToggle({
    stickToBottom,
    isAtBottom,
    showJump,
  });
  const visuals = resolveStickyToggleVisuals({ stickToBottom, unreadCount });

  return (
    <button
      type="button"
      role="switch"
      aria-pressed={visuals.ariaPressed}
      aria-checked={visuals.ariaPressed}
      aria-label={visuals.ariaLabel}
      onClick={() => onToggle(!stickToBottom)}
      data-scroll-to-bottom
      data-sticky={stickToBottom ? 'on' : 'off'}
      className={`
        absolute bottom-4 left-1/2 -translate-x-1/2 z-10
        flex items-center gap-1.5 px-3 py-1.5
        text-xs font-medium rounded-full
        border shadow-lg
        transition-all duration-200 ease-out
        ${
          stickToBottom
            ? 'bg-[var(--color-agent)] border-[var(--color-agent)] text-white hover:opacity-90'
            : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)] hover:border-[var(--color-agent)]'
        }
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}
      `}
    >
      <span
        aria-hidden="true"
        className={`relative w-7 h-4 rounded-full transition-colors flex-shrink-0 ${
          stickToBottom
            ? 'bg-white/30 border border-white/50'
            : 'bg-[var(--color-surface-alt)] border border-[var(--color-border)]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
            stickToBottom
              ? 'left-3.5 bg-white'
              : 'left-0.5 bg-[var(--color-text-muted)]'
          }`}
        />
      </span>
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
      <span>{visuals.label}</span>
      <kbd className="ml-1 px-1 py-0.5 rounded text-[9px] bg-[var(--color-border)] text-[var(--color-text-faint)]">
        End
      </kbd>
    </button>
  );
});

export default ScrollToBottomButton;
