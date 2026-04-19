import { describe, expect, it } from 'vitest';
import { shouldRescrollOnResize } from './auto-scroll-resize';

describe('shouldRescrollOnResize', () => {
  it('returns false when not following output', () => {
    expect(
      shouldRescrollOnResize({
        prevHeight: 100,
        nextHeight: 200,
        isFollowing: false,
        messageCount: 5,
      }),
    ).toBe(false);
  });

  it('returns false when there are no messages', () => {
    expect(
      shouldRescrollOnResize({
        prevHeight: null,
        nextHeight: 0,
        isFollowing: true,
        messageCount: 0,
      }),
    ).toBe(false);
  });

  it('returns true on the first observation while following', () => {
    expect(
      shouldRescrollOnResize({
        prevHeight: null,
        nextHeight: 800,
        isFollowing: true,
        messageCount: 3,
      }),
    ).toBe(true);
  });

  it('returns true when height grew (late row measurement)', () => {
    expect(
      shouldRescrollOnResize({
        prevHeight: 800,
        nextHeight: 920,
        isFollowing: true,
        messageCount: 3,
      }),
    ).toBe(true);
  });

  it('returns true when height shrank (row collapsed / removed)', () => {
    expect(
      shouldRescrollOnResize({
        prevHeight: 800,
        nextHeight: 600,
        isFollowing: true,
        messageCount: 3,
      }),
    ).toBe(true);
  });

  it('returns false when height is unchanged (no-op resize)', () => {
    expect(
      shouldRescrollOnResize({
        prevHeight: 800,
        nextHeight: 800,
        isFollowing: true,
        messageCount: 3,
      }),
    ).toBe(false);
  });
});
