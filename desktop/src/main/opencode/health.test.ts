import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkOpenCodeHealth } from './health';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

describe('checkOpenCodeHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('returns healthy status when server responds', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            list: vi.fn().mockResolvedValue({
              data: [],
              error: undefined,
            }),
          },
        }) as never,
    );

    const result = await checkOpenCodeHealth(5000);

    expect(result.available).toBe(true);
    expect(result.healthy).toBe(true);
    // Version not available from session.list
    expect(result.version).toBe(null);
  });

  it('returns unavailable when connection fails', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            list: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          },
        }) as never,
    );

    const result = await checkOpenCodeHealth(5000);

    expect(result.available).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
