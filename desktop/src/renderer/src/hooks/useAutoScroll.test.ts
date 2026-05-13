import { describe, expect, it } from 'vitest';
import {
  createAutoScrollMarker,
  getProgrammaticScrollTarget,
  isWithinProgrammaticScrollWindow,
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

  it('resumes sticky state when the user scrolls back to bottom', () => {
    expect(
      nextStickyStateOnScroll({
        prev: false,
        distance: 10,
        threshold: 10,
        wasAuto: false,
      }),
    ).toBe(true);
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

  it('keeps smooth scroll frames programmatic while the window is open', () => {
    expect(isWithinProgrammaticScrollWindow(1500, 1200)).toBe(true);
    expect(isWithinProgrammaticScrollWindow(1500, 1600)).toBe(false);
  });

  it('prefers the bottom anchor over scrollTop calculations', () => {
    const element = {} as HTMLElement;
    expect(
      getProgrammaticScrollTarget({ bottomAnchor: element, fallbackTop: 200 }),
    ).toEqual({ type: 'anchor', element });
  });

  it('falls back to scrollTop when no bottom anchor exists', () => {
    expect(
      getProgrammaticScrollTarget({ bottomAnchor: null, fallbackTop: 200 }),
    ).toEqual({ type: 'scrollTop', top: 200 });
  });
});
