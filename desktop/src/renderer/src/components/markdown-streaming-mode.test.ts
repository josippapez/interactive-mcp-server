import { describe, expect, it } from 'vitest';
import { shouldUsePlainStreamingText } from './markdown-streaming-mode';

describe('shouldUsePlainStreamingText', () => {
  it('uses plain text while streaming so chat updates remain real-time', () => {
    expect(
      shouldUsePlainStreamingText({
        streaming: true,
      }),
    ).toBe(true);
  });

  it('uses the full markdown renderer after streaming completes', () => {
    expect(
      shouldUsePlainStreamingText({
        streaming: false,
      }),
    ).toBe(false);
  });
});
