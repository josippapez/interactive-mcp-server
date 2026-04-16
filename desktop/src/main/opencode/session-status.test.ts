import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSessionStatus } from './session-status';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

describe('fetchSessionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('returns status from the server', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            status: vi.fn().mockResolvedValue({
              data: {
                ses_a: { type: 'busy' },
                ses_b: { type: 'idle' },
              },
              error: undefined,
            }),
          },
        }) as never,
    );

    const result = await fetchSessionStatus(5000);

    expect(result).toEqual({
      ses_a: { type: 'busy' },
      ses_b: { type: 'idle' },
    });
  });

  it('returns null when connection fails', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            status: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          },
        }) as never,
    );

    const result = await fetchSessionStatus(5000);

    expect(result).toBeNull();
  });
});
