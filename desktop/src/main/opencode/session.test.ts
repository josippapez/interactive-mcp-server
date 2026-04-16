import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchAllOpenCodeSessions,
  autoDetectOpenCodeSession,
  createOpenCodeSession,
} from './session';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

describe('autoDetectOpenCodeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('returns null when no sessions are available', async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: [],
      error: undefined,
    });
    _setClientFactory(
      (_port, dir) => {
        expect(dir).toBe('/repo');
        return {
          session: {
            list: listMock,
          },
        } as never;
      },
    );

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toBeNull();
    expect(listMock).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it('prefers a root session over a newer subagent session', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            list: vi.fn().mockResolvedValue({
              data: [
                { id: 'ses_root', time: { created: 100 } },
                {
                  id: 'ses_child',
                  parentID: 'ses_root',
                  time: { created: 200 },
                },
              ],
              error: undefined,
            }),
          },
        }) as never,
    );

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toEqual({ id: 'ses_root', parentId: null });
  });

  it('picks the most recently created root when multiple roots exist', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            list: vi.fn().mockResolvedValue({
              data: [
                { id: 'ses_root_old', time: { created: 100 } },
                { id: 'ses_root_new', time: { created: 300 } },
                {
                  id: 'ses_child',
                  parentID: 'ses_root_new',
                  time: { created: 400 },
                },
              ],
              error: undefined,
            }),
          },
        }) as never,
    );

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toEqual({ id: 'ses_root_new', parentId: null });
  });

  it('falls back to the newest child when there are no root sessions', async () => {
    let callCount = 0;
    _setClientFactory(
      (_port, dir) =>
        ({
          session: {
            list: vi.fn().mockImplementation(async () => {
              callCount++;
              if (dir) {
                return { data: [], error: undefined };
              }
              return {
                data: [
                  {
                    id: 'ses_child_a',
                    parentID: 'ses_gone',
                    time: { created: 100 },
                  },
                  {
                    id: 'ses_child_b',
                    parentID: 'ses_gone',
                    time: { created: 200 },
                  },
                ],
                error: undefined,
              };
            }),
          },
        }) as never,
    );

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toEqual({ id: 'ses_child_b', parentId: 'ses_gone' });
  });

  it('returns parentId correctly for a root session', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            list: vi.fn().mockResolvedValue({
              data: [{ id: 'ses_root', time: { created: 100 } }],
              error: undefined,
            }),
          },
        }) as never,
    );

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result?.parentId).toBeNull();
  });
});

describe('fetchAllOpenCodeSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('returns unscoped sessions when /session has data and no directories are provided', async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: [{ id: 'ses_a', time: { created: 2 } }],
      error: undefined,
    });

    _setClientFactory(
      () =>
        ({
          session: { list: listMock },
        }) as never,
    );

    const sessions = await fetchAllOpenCodeSessions(4096);

    expect(sessions).toEqual([{ id: 'ses_a', time: { created: 2 } }]);
  });

  it('returns empty array when unscoped is empty and no directories are provided', async () => {
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

    const sessions = await fetchAllOpenCodeSessions(4096);
    expect(sessions).toEqual([]);
  });

  it('returns null when all fetches fail', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            list: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          },
        }) as never,
    );

    const sessions = await fetchAllOpenCodeSessions(5000);
    expect(sessions).toBeNull();
  });
});

describe('createOpenCodeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('creates a session successfully', async () => {
    const createMock = vi.fn().mockResolvedValue({
      data: { id: 'ses_new' },
      error: undefined,
    });
    _setClientFactory(
      (_port, dir) => {
        expect(dir).toBeUndefined();
        return {
          session: {
            create: createMock,
            promptAsync: vi.fn().mockResolvedValue({
              data: {},
              error: undefined,
            }),
          },
        } as never;
      },
    );

    const result = await createOpenCodeSession(4096, {
      title: 'Test Session',
    });

    expect(result.ok).toBe(true);
    expect(result.session?.id).toBe('ses_new');
    expect(createMock).toHaveBeenCalledWith({
      body: {
        title: 'Test Session',
        parentID: undefined,
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('creates a session with a directory-scoped client when directory is provided', async () => {
    const createMock = vi.fn().mockResolvedValue({
      data: { id: 'ses_new' },
      error: undefined,
    });

    _setClientFactory(
      (_port, dir) => {
        expect(dir).toBe('/repo');
        return {
          session: {
            create: createMock,
            promptAsync: vi.fn().mockResolvedValue({
              data: {},
              error: undefined,
            }),
          },
        } as never;
      },
    );

    const result = await createOpenCodeSession(4096, {
      title: 'Test Session',
      directory: '/repo',
    });

    expect(result.ok).toBe(true);
    expect(createMock).toHaveBeenCalledWith({
      body: {
        title: 'Test Session',
        parentID: undefined,
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('sends initial message when provided', async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({
      data: {},
      error: undefined,
    });

    _setClientFactory(
      () =>
        ({
          session: {
            create: vi.fn().mockResolvedValue({
              data: { id: 'ses_new' },
              error: undefined,
            }),
            promptAsync: promptAsyncMock,
          },
        }) as never,
    );

    const result = await createOpenCodeSession(4096, {
      initialMessage: 'hello',
    });

    expect(result.ok).toBe(true);
    expect(promptAsyncMock).toHaveBeenCalled();
  });

  it('returns error when session creation fails', async () => {
    _setClientFactory(
      () =>
        ({
          session: {
            create: vi.fn().mockResolvedValue({
              data: undefined,
              error: 'Creation failed',
            }),
          },
        }) as never,
    );

    const result = await createOpenCodeSession(4096, {
      title: 'Test',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
