import { describe, expect, it } from 'vitest';
import {
  _clearAllUsageForTest,
  setSessionTotalTokens,
  getSessionContextUsage,
} from './context-tracking';

describe('context tracking token normalization', () => {
  it('accepts OpenCode token objects when setting session totals', () => {
    _clearAllUsageForTest();

    const usage = setSessionTotalTokens('ses_token_object', {
      input: 1000,
      output: 200,
      cache: { read: 300, write: 50 },
    } as never);

    expect(usage.totalTokens).toBe(1550);
    expect(Number.isFinite(usage.usagePercent)).toBe(true);
    expect(getSessionContextUsage('ses_token_object')?.totalTokens).toBe(1550);
  });

  it('falls back to zero for invalid token totals', () => {
    _clearAllUsageForTest();

    const usage = setSessionTotalTokens('ses_invalid_tokens', {
      total: { bad: true },
    } as never);

    expect(usage.totalTokens).toBe(0);
    expect(usage.usagePercent).toBe(0);
  });
});
