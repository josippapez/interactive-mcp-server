import { describe, expect, it } from 'vitest';

import {
  formatReasoningVariant,
  normalizeReasoningVariant,
  normalizeReasoningVariants,
  toProviderReasoningVariant,
} from './reasoning-variant';

describe('reasoning-variant helpers', () => {
  it('normalizes max to xhigh', () => {
    expect(normalizeReasoningVariant('max')).toBe('xhigh');
  });

  it('normalizes x-high to xhigh', () => {
    expect(normalizeReasoningVariant('x-high')).toBe('xhigh');
  });

  it('deduplicates normalized variants', () => {
    expect(normalizeReasoningVariants(['low', 'max', 'xhigh'])).toEqual([
      'low',
      'xhigh',
    ]);
  });

  it('maps canonical xhigh back to provider max', () => {
    expect(toProviderReasoningVariant('xhigh')).toBe('max');
  });

  it('formats xhigh with explicit label', () => {
    expect(formatReasoningVariant('xhigh')).toBe('XHigh');
  });
});
