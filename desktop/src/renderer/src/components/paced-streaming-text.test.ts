import { describe, expect, it } from 'vitest';
import { getNextPacedTextEnd } from './paced-streaming-text';

describe('getNextPacedTextEnd', () => {
  it('advances small chunks and snaps to nearby word boundaries', () => {
    expect(getNextPacedTextEnd('hello world', 0)).toBe(6);
  });

  it('snaps forward to punctuation near the next chunk boundary', () => {
    expect(getNextPacedTextEnd('hello world. next', 8)).toBe(12);
  });

  it('uses larger chunks for long remaining text', () => {
    const text = 'x'.repeat(400);

    expect(getNextPacedTextEnd(text, 0)).toBe(24);
  });
});
