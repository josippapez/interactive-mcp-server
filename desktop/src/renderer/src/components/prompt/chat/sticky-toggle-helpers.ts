/**
 * Pure helpers for the stick-to-bottom toggle button.
 *
 * Extracted so the visual contract (label + accessible names + visibility) can
 * be unit-tested without rendering React.
 */

export interface StickyToggleVisuals {
  /** Visible label text inside the button. */
  label: string;
  /** Value for `aria-pressed`. */
  ariaPressed: boolean;
  /** Descriptive accessible name. */
  ariaLabel: string;
}

export interface ResolveStickyToggleVisualsInput {
  stickToBottom: boolean;
  unreadCount: number;
}

/**
 * Map the (stickToBottom, unreadCount) pair to the toggle's visible/aria
 * properties. Pure — no DOM, no React.
 */
export function resolveStickyToggleVisuals(
  input: ResolveStickyToggleVisualsInput,
): StickyToggleVisuals {
  const { stickToBottom, unreadCount } = input;

  if (stickToBottom) {
    return {
      label: 'Sticking to bottom',
      ariaPressed: true,
      ariaLabel: 'Disable stick to bottom',
    };
  }

  if (unreadCount > 0) {
    const noun = unreadCount === 1 ? 'message' : 'messages';
    return {
      label: `${unreadCount} new ${noun}`,
      ariaPressed: false,
      ariaLabel: 'Enable stick to bottom and jump to latest message',
    };
  }

  return {
    label: 'Jump to bottom',
    ariaPressed: false,
    ariaLabel: 'Enable stick to bottom and jump to latest message',
  };
}

export interface ShouldShowStickyToggleInput {
  stickToBottom: boolean;
  isAtBottom: boolean;
  showJump: boolean;
}

/**
 * The toggle is hidden only when sticky is ON *and* the view is currently at
 * the bottom — at that point there's nothing for the user to do. In every
 * other state (toggle OFF, scrolled away, far enough that the jump-button
 * threshold is exceeded) the control is shown.
 */
export function shouldShowStickyToggle(
  input: ShouldShowStickyToggleInput,
): boolean {
  const { stickToBottom, isAtBottom, showJump } = input;
  if (!stickToBottom) return true;
  if (!isAtBottom) return true;
  if (showJump) return true;
  return false;
}
