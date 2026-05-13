import { describe, expect, it } from 'vitest';
import {
  formatContextPercent,
  formatContextTokens,
  getContextUsageDisplay,
} from './ContextUsageBar';

describe('ContextUsageBar formatting', () => {
  it('formats finite token counts', () => {
    expect(formatContextTokens(0)).toBe('0');
    expect(formatContextTokens(999)).toBe('999');
    expect(formatContextTokens(1200)).toBe('1.2k');
    expect(formatContextTokens(1_200_000)).toBe('1.2M');
  });

  it('does not stringify invalid token values', () => {
    expect(formatContextTokens({ context: 400_000 })).toBe('--');
    expect(formatContextTokens(Number.NaN)).toBe('--');
    expect(formatContextTokens(undefined)).toBe('--');
  });

  it('does not format invalid percentages as NaN', () => {
    expect(formatContextPercent(Number.NaN)).toBe('--');
    expect(formatContextPercent(undefined)).toBe('--');
    expect(formatContextPercent(12.345)).toBe('12.3%');
  });

  it('builds a safe label and zero-width bar for invalid context limits', () => {
    const display = getContextUsageDisplay({
      totalTokens: 10_000,
      contextLimit: { context: 400_000 },
    });

    expect(display.label).toBe('Context 10.0k / -- (--)');
    expect(display.widthPercent).toBe(0);
  });
});
