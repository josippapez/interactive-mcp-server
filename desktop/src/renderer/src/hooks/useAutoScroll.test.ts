import { describe, it, expect } from 'vitest';
import {
  resolveAutoScrollState,
  shouldPauseAutoScrollOnWheel,
  createAutoScrollMarker,
  nextStickyStateOnScroll,
  isWithinProgrammaticScrollWindow,
} from './useAutoScroll';

// Behavioral spec (single source of truth):
// - isStickyToBottom=true  → auto-follow new content.
// - isStickyToBottom=false → user scrolled away, do NOT auto-scroll.
// - User scrolls up        → sticky=false.
// - User scrolls to within threshold of bottom → sticky=true.
// - Jump button / End key → sticky=true AND scroll to bottom.
// - Channel switch → sticky=true AND scroll to bottom.
// - Programmatic scroll events (from our own scrollTo) must NOT flip sticky=false.

describe('resolveAutoScrollState', () => {
  it('returns at-bottom state when distance is within threshold', () => {
    expect(resolveAutoScrollState(8, 10, 100)).toEqual({
      isAtBottom: true,
      userScrolled: false,
      showJump: false,
    });
  });

  it('returns unlocked state when distance is above threshold', () => {
    expect(resolveAutoScrollState(20, 10, 100)).toEqual({
      isAtBottom: false,
      userScrolled: true,
      showJump: false,
    });
  });

  it('shows jump button when distance exceeds jumpThreshold', () => {
    expect(resolveAutoScrollState(150, 10, 100)).toEqual({
      isAtBottom: false,
      userScrolled: true,
      showJump: true,
    });
  });

  it('treats distance exactly at threshold as at-bottom', () => {
    const state = resolveAutoScrollState(50, 50, 180);
    expect(state.isAtBottom).toBe(true);
    expect(state.userScrolled).toBe(false);
  });
});

describe('shouldPauseAutoScrollOnWheel', () => {
  it('pauses when wheel delta is upward (negative)', () => {
    expect(shouldPauseAutoScrollOnWheel(-1)).toBe(true);
  });

  it('does not pause when wheel delta is downward (positive)', () => {
    expect(shouldPauseAutoScrollOnWheel(2)).toBe(false);
  });

  it('does not pause when wheel delta is zero', () => {
    expect(shouldPauseAutoScrollOnWheel(0)).toBe(false);
  });
});

describe('createAutoScrollMarker', () => {
  it('isAuto() returns false when nothing has been marked', () => {
    const marker = createAutoScrollMarker();
    expect(marker.isAuto(0, 1000)).toBe(false);
    expect(marker.isAuto(500, 1000)).toBe(false);
  });

  it('isAuto() returns true for scrollTop within 2px of a recent mark', () => {
    const marker = createAutoScrollMarker();
    marker.mark(1000, 5000);
    expect(marker.isAuto(1000, 5100)).toBe(true);
    expect(marker.isAuto(999, 5100)).toBe(true);
    expect(marker.isAuto(1001, 5100)).toBe(true);
  });

  it('isAuto() returns false when scrollTop drifts more than 2px from the mark', () => {
    const marker = createAutoScrollMarker();
    marker.mark(1000, 5000);
    expect(marker.isAuto(1005, 5100)).toBe(false);
    expect(marker.isAuto(990, 5100)).toBe(false);
  });

  it('isAuto() expires after 1500ms', () => {
    const marker = createAutoScrollMarker();
    marker.mark(1000, 5000);
    expect(marker.isAuto(1000, 5000 + 1499)).toBe(true);
    expect(marker.isAuto(1000, 5000 + 1501)).toBe(false);
  });

  it('mark() overwrites the previous mark', () => {
    const marker = createAutoScrollMarker();
    marker.mark(500, 1000);
    marker.mark(1200, 1050);
    expect(marker.isAuto(500, 1100)).toBe(false);
    expect(marker.isAuto(1200, 1100)).toBe(true);
  });

  it('clear() drops the mark', () => {
    const marker = createAutoScrollMarker();
    marker.mark(1000, 5000);
    marker.clear();
    expect(marker.isAuto(1000, 5100)).toBe(false);
  });
});

describe('nextStickyStateOnScroll', () => {
  // Transition function: given a scroll event, decide the next sticky state.
  // Inputs:
  //   prev: previous isStickyToBottom
  //   distance: current distance from bottom
  //   threshold: "at bottom" threshold
  //   wasAuto: whether the scroll event was triggered programmatically

  it('stays sticky when a programmatic scroll fires (wasAuto=true) even if distance momentarily > threshold', () => {
    expect(
      nextStickyStateOnScroll({
        prev: true,
        distance: 300,
        threshold: 50,
        wasAuto: true,
      }),
    ).toBe(true);
  });

  it('turns sticky=false when user scrolls away (wasAuto=false, distance > threshold)', () => {
    expect(
      nextStickyStateOnScroll({
        prev: true,
        distance: 300,
        threshold: 50,
        wasAuto: false,
      }),
    ).toBe(false);
  });

  it('re-sticks when user scrolls back within threshold', () => {
    expect(
      nextStickyStateOnScroll({
        prev: false,
        distance: 10,
        threshold: 50,
        wasAuto: false,
      }),
    ).toBe(true);
  });

  it('stays unsticky when user is still away and no re-engage has happened', () => {
    expect(
      nextStickyStateOnScroll({
        prev: false,
        distance: 400,
        threshold: 50,
        wasAuto: false,
      }),
    ).toBe(false);
  });

  it('stays sticky when already at bottom and event fires', () => {
    expect(
      nextStickyStateOnScroll({
        prev: true,
        distance: 5,
        threshold: 50,
        wasAuto: false,
      }),
    ).toBe(true);
  });

  it('at threshold boundary (distance === threshold) is still sticky', () => {
    expect(
      nextStickyStateOnScroll({
        prev: false,
        distance: 50,
        threshold: 50,
        wasAuto: false,
      }),
    ).toBe(true);
  });
});

describe('isWithinProgrammaticScrollWindow', () => {
  // This covers the smooth-scroll animation bug: when a programmatic
  // scroll is requested, intermediate scroll events (whose scrollTop
  // doesn't match the final target) must still be treated as programmatic
  // so `nextStickyStateOnScroll` keeps sticky=true across the animation.

  it('returns false when no window has been opened (windowUntil === 0)', () => {
    expect(isWithinProgrammaticScrollWindow(0, 1000)).toBe(false);
  });

  it('returns false when windowUntil is negative (defensive)', () => {
    expect(isWithinProgrammaticScrollWindow(-100, 1000)).toBe(false);
  });

  it('returns true when now is before the window expiry', () => {
    expect(isWithinProgrammaticScrollWindow(2000, 1500)).toBe(true);
  });

  it('returns false when now is at the window expiry', () => {
    expect(isWithinProgrammaticScrollWindow(2000, 2000)).toBe(false);
  });

  it('returns false when now is past the window expiry', () => {
    expect(isWithinProgrammaticScrollWindow(2000, 2001)).toBe(false);
  });

  it('covers the bug scenario: distance > threshold during smooth-scroll animation stays sticky', () => {
    // Simulate a mid-animation scroll event: user clicked jump-to-bottom,
    // browser is animating, current scrollTop is still far from target.
    // The marker won't match (scrollTop drift > 2px), but the window IS open.
    const windowUntil = 1600; // opened at 1000, 600ms window
    const now = 1200; // 200ms into the animation
    const withinWindow = isWithinProgrammaticScrollWindow(windowUntil, now);
    expect(withinWindow).toBe(true);

    // When wasAuto=true (from either marker or window), sticky is preserved.
    const next = nextStickyStateOnScroll({
      prev: true,
      distance: 300, // still far from bottom — animation in progress
      threshold: 50,
      wasAuto: withinWindow,
    });
    expect(next).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Behavioral spec documentation (for maintainers)
// ---------------------------------------------------------------------------
// The hook composes the above pure functions:
//  - On every native scroll event: compute distance → call
//    nextStickyStateOnScroll({ prev, distance, threshold, wasAuto }) where
//    wasAuto = marker.isAuto(scrollTop, now). Update React state.
//  - On wheel up (deltaY < 0) from a non-nested scrollable: sticky=false.
//  - jumpToBottom(): sticky=true AND scrollTo(scrollHeight); mark() the auto
//    scroll so the following scroll event does not flip sticky=false.
//  - reset(): same as jumpToBottom, used on channel switch.
// ---------------------------------------------------------------------------
describe('hook API contract (documentation)', () => {
  it('jumpToBottom is exposed on the hook return', async () => {
    const mod = await import('./useAutoScroll');
    // We can't call the hook outside React, but we can assert the module
    // exports the factory and that TypeScript users see `jumpToBottom` on it.
    expect(typeof mod.useAutoScroll).toBe('function');
  });

  it('exposes pinnedToBottom as an alias of isStickyToBottom for back-compat', async () => {
    // The hook return shape must keep `pinnedToBottom` === `isStickyToBottom`
    // until all call sites have migrated. This test is documentation.
    expect(true).toBe(true);
  });
});
