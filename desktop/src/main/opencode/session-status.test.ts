import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSessionStatus } from './session-status';

describe('fetchSessionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Unexpected unmocked fetch call'),
    );
  });

  it('merges statuses from multiple reachable ports', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ses_a: { type: 'busy' },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ses_b: { type: 'idle' },
        }),
      } as Response);

    const result = await fetchSessionStatus(5000);

    expect(result).toEqual({
      ses_a: { type: 'busy' },
      ses_b: { type: 'idle' },
    });
  });
});
