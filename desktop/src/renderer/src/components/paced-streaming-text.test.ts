import { describe, expect, it } from 'vitest';
import {
  getNextPacedTextEnd,
  getPacedStreamingTextUpdate,
} from './paced-streaming-text';

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

describe('getPacedStreamingTextUpdate', () => {
  it('reveals only the next paced slice while streaming text grows', () => {
    expect(
      getPacedStreamingTextUpdate({
        text: 'hello world',
        shown: '',
        streaming: true,
      }),
    ).toEqual({ value: 'hello ', done: false });
  });

  it('syncs immediately when streaming stops', () => {
    expect(
      getPacedStreamingTextUpdate({
        text: 'hello world',
        shown: 'hello ',
        streaming: false,
      }),
    ).toEqual({ value: 'hello world', done: true });
  });

  it('syncs immediately when streamed text is replaced instead of appended', () => {
    expect(
      getPacedStreamingTextUpdate({
        text: 'replacement',
        shown: 'hello ',
        streaming: true,
      }),
    ).toEqual({ value: 'replacement', done: true });
  });
});
