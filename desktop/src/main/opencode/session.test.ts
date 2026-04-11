import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { fetchAllOpenCodeSessions, autoDetectOpenCodeSession } from './session';

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('autoDetectOpenCodeSession', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no sessions are available', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toBeNull();
  });

  it('prefers a root session over a newer subagent session', async () => {
    // Scoped query returns both a root and a newer child
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'ses_root', time: { created: 100 } },
        { id: 'ses_child', parentID: 'ses_root', time: { created: 200 } },
      ],
    });

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toEqual({ id: 'ses_root', parentId: null });
  });

  it('picks the most recently created root when multiple roots exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'ses_root_old', time: { created: 100 } },
        { id: 'ses_root_new', time: { created: 300 } },
        { id: 'ses_child', parentID: 'ses_root_new', time: { created: 400 } },
      ],
    });

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toEqual({ id: 'ses_root_new', parentId: null });
  });

  it('falls back to the newest child when there are no root sessions', async () => {
    // Scoped query empty, fallback returns only children
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'ses_child_a', parentID: 'ses_gone', time: { created: 100 } },
          { id: 'ses_child_b', parentID: 'ses_gone', time: { created: 200 } },
        ],
      });

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toEqual({ id: 'ses_child_b', parentId: 'ses_gone' });
  });

  it('returns parentId correctly for a root session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'ses_root', time: { created: 100 } }],
    });

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result?.parentId).toBeNull();
  });
});

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
