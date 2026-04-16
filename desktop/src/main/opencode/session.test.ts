import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchAllOpenCodeSessions,
  fetchOpenCodeSession,
  fetchOpenCodeSessionChildren,
  fetchRootOpenCodeSessions,
  expandOpenCodeSessionTree,
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
    _setClientFactory((_port, dir) => {
      expect(dir).toBe('/repo');
      return {
        session: {
          list: listMock,
        },
      } as never;
    });

    const result = await autoDetectOpenCodeSession(4096, '/repo');
    expect(result).toBeNull();
    expect(listMock).toHaveBeenCalledWith(
      { roots: undefined, directory: '/repo' },
      { signal: expect.any(AbortSignal) },
    );
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
    _setClientFactory(
      (_port, dir) =>
        ({
          session: {
            list: vi.fn().mockImplementation(async () => {
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

  it('does not scope to process cwd when baseDirectory is omitted', async () => {
    const listMock = vi.fn().mockResolvedValueOnce({
      data: [{ id: 'ses_root', time: { created: 100 } }],
      error: undefined,
    });

    _setClientFactory((_port, dir) => {
      expect(dir).toBeUndefined();
      return {
        session: {
          list: listMock,
        },
      } as never;
    });

    const result = await autoDetectOpenCodeSession(4096);

    expect(result).toEqual({ id: 'ses_root', parentId: null });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith(
      { roots: undefined },
      { signal: expect.any(AbortSignal) },
    );
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

describe('fetchOpenCodeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('returns a hydrated session by id', async () => {
    const getMock = vi.fn().mockResolvedValue({
      data: { id: 'ses_a', title: 'Hydrated', parentID: null },
      error: undefined,
    });

    _setClientFactory((_port, dir) => {
      expect(dir).toBe('/repo');
      return {
        session: { get: getMock },
      } as never;
    });

    const session = await fetchOpenCodeSession(4096, 'ses_a', '/repo');

    expect(session).toEqual({ id: 'ses_a', title: 'Hydrated', parentID: null });
    expect(getMock).toHaveBeenCalledWith(
      { sessionID: 'ses_a', directory: '/repo' },
      { signal: expect.any(AbortSignal) },
    );
  });
});

describe('root and children session fetches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('fetches root sessions with roots=true', async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: [{ id: 'root-1', parentID: null }],
      error: undefined,
    });

    _setClientFactory(
      () =>
        ({
          session: { list: listMock },
        }) as never,
    );

    const sessions = await fetchRootOpenCodeSessions(4096);

    expect(sessions).toEqual([{ id: 'root-1', parentID: null }]);
    expect(listMock).toHaveBeenCalledWith(
      { roots: true },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('fetches child sessions by parent session id', async () => {
    const childrenMock = vi.fn().mockResolvedValue({
      data: [{ id: 'child-1', parentID: 'root-1' }],
      error: undefined,
    });

    _setClientFactory((_port, dir) => {
      expect(dir).toBe('/repo');
      return {
        session: { children: childrenMock },
      } as never;
    });

    const sessions = await fetchOpenCodeSessionChildren(
      4096,
      'root-1',
      '/repo',
    );

    expect(sessions).toEqual([{ id: 'child-1', parentID: 'root-1' }]);
    expect(childrenMock).toHaveBeenCalledWith(
      { sessionID: 'root-1', directory: '/repo' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('expands a full session tree from roots using children API', async () => {
    const childrenMock = vi.fn().mockImplementation(async ({ sessionID }) => {
      if (sessionID === 'root-1') {
        return {
          data: [{ id: 'child-1', parentID: 'root-1', directory: '/repo' }],
          error: undefined,
        };
      }
      return { data: [], error: undefined };
    });

    _setClientFactory(
      () =>
        ({
          session: { children: childrenMock },
        }) as never,
    );

    const sessions = await expandOpenCodeSessionTree(4096, [
      {
        id: 'root-1',
        parentID: null,
        directory: '/repo',
        time: { created: 1 },
      },
    ]);

    expect(sessions.map((item) => item.id)).toEqual(['root-1', 'child-1']);
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
    _setClientFactory((_port, dir) => {
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
    });

    const result = await createOpenCodeSession(4096, {
      title: 'Test Session',
    });

    expect(result.ok).toBe(true);
    expect(result.session?.id).toBe('ses_new');
    expect(createMock).toHaveBeenCalledWith(
      { title: 'Test Session', parentID: undefined },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('creates a session with a directory-scoped client when directory is provided', async () => {
    const createMock = vi.fn().mockResolvedValue({
      data: { id: 'ses_new' },
      error: undefined,
    });

    _setClientFactory((_port, dir) => {
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
    });

    const result = await createOpenCodeSession(4096, {
      title: 'Test Session',
      directory: '/repo',
    });

    expect(result.ok).toBe(true);
    expect(createMock).toHaveBeenCalledWith(
      { title: 'Test Session', parentID: undefined, directory: '/repo' },
      { signal: expect.any(AbortSignal) },
    );
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
