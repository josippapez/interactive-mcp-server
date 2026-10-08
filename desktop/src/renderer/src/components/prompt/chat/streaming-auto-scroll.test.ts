import { describe, expect, it } from 'vitest';
import {
  getNextBottomAnchorFrameCount,
  shouldDelayStreamingAutoScroll,
} from './streaming-auto-scroll';

describe('shouldDelayStreamingAutoScroll', () => {
  it('delays auto-scroll while the streamed body is still growing', () => {
    expect(
      shouldDelayStreamingAutoScroll({
        previousSignature: '3|msg|100|0',
        nextSignature: '3|msg|120|0',
      }),
    ).toBe(true);
  });

  it('does not delay when a new message appears', () => {
    expect(
      shouldDelayStreamingAutoScroll({
        previousSignature: '3|msg|100|0',
        nextSignature: '4|next|1|0',
      }),
    ).toBe(false);
  });
});

describe('getNextBottomAnchorFrameCount', () => {
  it('keeps a short frame tail while streaming is still active', () => {
    expect(
      getNextBottomAnchorFrameCount({ remainingFrames: 90, working: true }),
    ).toBe(12);
  });

  it('counts down when streaming has settled', () => {
    expect(
      getNextBottomAnchorFrameCount({ remainingFrames: 3, working: false }),
    ).toBe(2);
  });

  it('stops once the settled frame tail reaches zero', () => {
    expect(
      getNextBottomAnchorFrameCount({ remainingFrames: 1, working: false }),
    ).toBe(0);
  });
});
