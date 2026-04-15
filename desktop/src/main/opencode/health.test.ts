import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkOpenCodeHealth } from './health';

describe('checkOpenCodeHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Unexpected unmocked fetch call'),
    );
  });

  it('returns the configured port when healthy', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ healthy: true, version: '1.0.0' }),
    } as Response);

    const result = await checkOpenCodeHealth(5000);

    expect(result.available).toBe(true);
    expect(result.healthy).toBe(true);
    expect(result.activePort).toBe(5000);
    expect(result.reachablePorts).toEqual([5000]);
  });

  it('falls back to default port when configured port is down', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ healthy: true, version: '1.0.0' }),
      } as Response);

    const result = await checkOpenCodeHealth(5000);

    expect(result.available).toBe(true);
    expect(result.activePort).toBe(4096);
    expect(result.reachablePorts).toEqual([4096]);
  });
});
