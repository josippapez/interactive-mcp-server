import { describe, expect, it } from 'vitest';
import {
  createAutoScrollMarker,
  nextStickyStateOnScroll,
  resolveAutoScrollState,
  shouldPauseAutoScrollOnWheel,
} from './useAutoScroll';

describe('useAutoScroll helpers', () => {
  it('treats threshold-distance scroll positions as at bottom', () => {
    expect(resolveAutoScrollState(10, 10, 400)).toEqual({
      isAtBottom: true,
      userScrolled: false,
      showJump: false,
    });
  });

  it('shows jump control only past the jump threshold', () => {
    expect(resolveAutoScrollState(401, 10, 400).showJump).toBe(true);
  });

  it('preserves sticky state during programmatic scrolls', () => {
    expect(
      nextStickyStateOnScroll({
        prev: true,
        distance: 500,
        threshold: 10,
        wasAuto: true,
      }),
    ).toBe(true);
  });

  it('pauses only on upward wheel input', () => {
    expect(shouldPauseAutoScrollOnWheel(-1)).toBe(true);
    expect(shouldPauseAutoScrollOnWheel(1)).toBe(false);
  });

  it('matches marked programmatic scroll targets within tolerance', () => {
    const marker = createAutoScrollMarker();
    marker.mark(100, 1000);
    expect(marker.isAuto(101, 1100)).toBe(true);
    expect(marker.isAuto(103, 1100)).toBe(false);
  });
});
