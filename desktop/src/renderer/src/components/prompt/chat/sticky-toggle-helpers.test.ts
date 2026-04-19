import { describe, expect, it } from 'vitest';
import {
  resolveStickyToggleVisuals,
  shouldShowStickyToggle,
} from './sticky-toggle-helpers';

// The sticky-toggle visuals encode the four observable states of the toggle
// (button label, aria-pressed, aria-label) as a pure function of two inputs:
//   - stickToBottom: the user's preference (atom value)
//   - unreadCount:   number of unread messages while OFF / not at bottom
// Keeping the mapping pure means we can verify the accessible names without
// rendering React.

describe('resolveStickyToggleVisuals', () => {
  it('reports ON state when stickToBottom=true', () => {
    const v = resolveStickyToggleVisuals({
      stickToBottom: true,
      unreadCount: 0,
    });
    expect(v.ariaPressed).toBe(true);
    expect(v.label).toBe('Sticking to bottom');
    expect(v.ariaLabel).toMatch(/disable/i);
    expect(v.ariaLabel).toMatch(/stick/i);
  });

  it('reports OFF state with no unread when stickToBottom=false and unreadCount=0', () => {
    const v = resolveStickyToggleVisuals({
      stickToBottom: false,
      unreadCount: 0,
    });
    expect(v.ariaPressed).toBe(false);
    expect(v.label).toBe('Jump to bottom');
    expect(v.ariaLabel).toMatch(/enable/i);
    expect(v.ariaLabel).toMatch(/stick/i);
  });

  it('shows unread-count label when stickToBottom=false and unreadCount>0', () => {
    const v = resolveStickyToggleVisuals({
      stickToBottom: false,
      unreadCount: 1,
    });
    expect(v.ariaPressed).toBe(false);
    expect(v.label).toBe('1 new message');
  });

  it('pluralises the unread-count label correctly', () => {
    const v = resolveStickyToggleVisuals({
      stickToBottom: false,
      unreadCount: 4,
    });
    expect(v.label).toBe('4 new messages');
  });

  it('still reports ON when there are unread messages but the toggle is on (e.g. mid-scroll-back)', () => {
    const v = resolveStickyToggleVisuals({
      stickToBottom: true,
      unreadCount: 5,
    });
    expect(v.ariaPressed).toBe(true);
    expect(v.label).toBe('Sticking to bottom');
  });
});

describe('shouldShowStickyToggle', () => {
  // The toggle is visible whenever
  //   - the user has opted out of stick-to-bottom (so they can opt back in), OR
  //   - the view is currently scrolled away from the bottom.
  // It hides when both conditions are false (stick=ON and at bottom).
  it('hides when sticky is ON and the user is at the bottom', () => {
    expect(
      shouldShowStickyToggle({
        stickToBottom: true,
        isAtBottom: true,
        showJump: false,
      }),
    ).toBe(false);
  });

  it('shows when sticky is OFF even if the user is at the bottom', () => {
    expect(
      shouldShowStickyToggle({
        stickToBottom: false,
        isAtBottom: true,
        showJump: false,
      }),
    ).toBe(true);
  });

  it('shows when the user is scrolled away from the bottom', () => {
    expect(
      shouldShowStickyToggle({
        stickToBottom: true,
        isAtBottom: false,
        showJump: false,
      }),
    ).toBe(true);
  });

  it('shows when the jump-button distance threshold is exceeded', () => {
    expect(
      shouldShowStickyToggle({
        stickToBottom: true,
        isAtBottom: true,
        showJump: true,
      }),
    ).toBe(true);
  });
});
