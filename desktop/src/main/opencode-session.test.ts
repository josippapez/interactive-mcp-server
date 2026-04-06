import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { fetchAllOpenCodeSessions } from './opencode-session';

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('fetchAllOpenCodeSessions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns unscoped sessions when /session has data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'ses_a', time: { created: 2 } }],
    });

    const sessions = await fetchAllOpenCodeSessions(4096, ['/repo/a']);

    expect(sessions).toEqual([{ id: 'ses_a', time: { created: 2 } }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4096/session',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('falls back to directory-scoped queries when /session is empty', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'ses_a', time: { created: 100 } },
          { id: 'ses_dup', time: { created: 50 } },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'ses_b', time: { created: 200 } },
          { id: 'ses_dup', time: { created: 75 } },
        ],
      });

    const sessions = await fetchAllOpenCodeSessions(4096, [
      '/repo/a',
      '/repo/b',
    ]);

    expect(sessions).toEqual([
      { id: 'ses_b', time: { created: 200 } },
      { id: 'ses_a', time: { created: 100 } },
      { id: 'ses_dup', time: { created: 75 } },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4096/session?directory=%2Frepo%2Fa',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4096/session?directory=%2Frepo%2Fb',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns empty array when unscoped is empty and no directories are provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    const sessions = await fetchAllOpenCodeSessions(4096);

    expect(sessions).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when unscoped fetch is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const sessions = await fetchAllOpenCodeSessions(4096, ['/repo/a']);

    expect(sessions).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
