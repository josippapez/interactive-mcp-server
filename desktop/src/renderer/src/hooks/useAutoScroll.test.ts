import { describe, expect, it } from 'vitest';
import {
  createAutoScrollMarker,
  getProgrammaticScrollTarget,
  getProgrammaticScrollWindowUntil,
  anchorScrollContainerToBottom,
  isWithinProgrammaticScrollWindow,
  isMeasuredAtBottom,
  nextStickyStateOnScroll,
  resolveAutoScrollState,
  shouldAnchorAfterResize,
  shouldUseBottomAnchor,
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

  it('preserves sticky state when content growth creates bottom distance without user intent', () => {
    expect(
      nextStickyStateOnScroll({
        prev: true,
        distance: 500,
        threshold: 10,
        wasAuto: false,
        hadUserIntent: false,
      }),
    ).toBe(true);
  });

  it('pauses sticky state when the user intentionally scrolls away', () => {
    expect(
      nextStickyStateOnScroll({
        prev: true,
        distance: 500,
        threshold: 10,
        wasAuto: false,
        hadUserIntent: true,
      }),
    ).toBe(false);
  });

  it('resumes sticky state at bottom even during programmatic scroll windows', () => {
    expect(
      nextStickyStateOnScroll({
        prev: false,
        distance: 0,
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

  it('does not keep auto bottom anchoring in a broad programmatic scroll window', () => {
    expect(getProgrammaticScrollWindowUntil('auto', 1000)).toBe(0);
  });

  it('keeps smooth scrolls in a broad programmatic scroll window', () => {
    expect(getProgrammaticScrollWindowUntil('smooth', 1000)).toBeGreaterThan(
      1000,
    );
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

  it('uses direct scrollTop anchoring for repeated auto bottom locks', () => {
    const element = {} as HTMLElement;
    expect(
      shouldUseBottomAnchor({ behavior: 'auto', bottomAnchor: element }),
    ).toBe(false);
  });

  it('keeps smooth jump-to-bottom aligned to the bottom anchor', () => {
    const element = {} as HTMLElement;
    expect(
      shouldUseBottomAnchor({ behavior: 'smooth', bottomAnchor: element }),
    ).toBe(true);
  });

  it('keeps bottom lock when a scroll container resize creates distance from bottom', () => {
    expect(shouldAnchorAfterResize({ canScroll: true, sticky: true })).toBe(
      true,
    );
  });

  it('uses OpenCode-style measured bottom tolerance', () => {
    expect(
      isMeasuredAtBottom({
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 596,
      }),
    ).toBe(true);
    expect(
      isMeasuredAtBottom({
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 595,
      }),
    ).toBe(false);
  });

  it('directly bottom-locks the scroll container without relying on calculations', () => {
    const element = {
      scrollHeight: 1000,
      scrollTop: 0,
    } as HTMLDivElement;

    expect(anchorScrollContainerToBottom(element)).toBe(true);
    expect(element.scrollTop).toBe(1000);
  });

  it('does not bottom-lock when no scroll container is available', () => {
    expect(anchorScrollContainerToBottom(null)).toBe(false);
  });

  it('does not re-anchor resized containers after the user scrolls away', () => {
    expect(shouldAnchorAfterResize({ canScroll: true, sticky: false })).toBe(
      false,
    );
  });
});
