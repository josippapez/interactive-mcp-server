import { describe, expect, it } from 'vitest';
import { shouldDelayStreamingAutoScroll } from './streaming-auto-scroll';

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
