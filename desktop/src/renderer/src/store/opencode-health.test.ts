import { describe, expect, it } from 'vitest';
import { areOpenCodeHealthStatusesEqual } from './opencode-health';

describe('areOpenCodeHealthStatusesEqual', () => {
  it('returns true for identical health statuses', () => {
    expect(
      areOpenCodeHealthStatusesEqual(
        { available: false, healthy: false, version: null, error: 'failed' },
        { available: false, healthy: false, version: null, error: 'failed' },
      ),
    ).toBe(true);
  });

  it('returns false when the health state changes', () => {
    expect(
      areOpenCodeHealthStatusesEqual(
        { available: false, healthy: false, version: null, error: 'failed' },
        { available: true, healthy: true, version: '1.0.0' },
      ),
    ).toBe(false);
  });
});
