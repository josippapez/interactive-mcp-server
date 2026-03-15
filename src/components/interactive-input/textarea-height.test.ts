import { describe, expect, it } from 'bun:test';

import { getTextareaDimensions } from './textarea-height.js';

describe('getTextareaDimensions', () => {
  it('grows with content and keeps containerHeight as rows + 2', () => {
    const shortValue = getTextareaDimensions({
      value: 'short',
      width: 80,
      terminalHeight: 40,
      isNarrow: false,
    });

    const tallValue = getTextareaDimensions({
      value: Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join(
        '\n',
      ),
      width: 80,
      terminalHeight: 40,
      isNarrow: false,
    });

    expect(tallValue.rows).toBeGreaterThan(shortValue.rows);
    expect(shortValue.containerHeight).toBe(shortValue.rows + 2);
    expect(tallValue.containerHeight).toBe(tallValue.rows + 2);
  });

  it('caps rows at 50 in wide mode when terminal allows it', () => {
    const dimensions = getTextareaDimensions({
      value: Array.from({ length: 180 }, () => 'x').join('\n'),
      width: 80,
      terminalHeight: 200,
      isNarrow: false,
    });

    expect(dimensions.rows).toBe(50);
    expect(dimensions.containerHeight).toBe(52);
  });

  it('caps rows at 50 in narrow mode when terminal allows it', () => {
    const dimensions = getTextareaDimensions({
      value: Array.from({ length: 180 }, () => 'x').join('\n'),
      width: 40,
      terminalHeight: 200,
      isNarrow: true,
    });

    expect(dimensions.rows).toBe(50);
    expect(dimensions.containerHeight).toBe(52);
  });

  it('caps by terminal-safe max rows on small terminals', () => {
    const dimensions = getTextareaDimensions({
      value: Array.from({ length: 180 }, () => 'x').join('\n'),
      width: 80,
      terminalHeight: 18,
      isNarrow: false,
    });

    expect(dimensions.rows).toBe(5);
    expect(dimensions.containerHeight).toBe(7);
  });
});
