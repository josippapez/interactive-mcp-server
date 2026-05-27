import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionApiMocks = vi.hoisted(() => ({
  sessionList: vi.fn(),
}));

vi.mock('./session-api', () => ({
  sessionList: sessionApiMocks.sessionList,
  sessionGet: vi.fn(),
  sessionChildren: vi.fn(),
  sessionCreate: vi.fn(),
  sessionPromptAsync: vi.fn(),
}));

import { fetchAllOpenCodeSessions, fetchRootOpenCodeSessions } from './session';

const PORT = 4096;

beforeEach(() => {
  sessionApiMocks.sessionList.mockReset();
});

describe('OpenCode session list helpers', () => {
  it('preserves OpenCode updated-time ordering when listing all sessions', async () => {
    sessionApiMocks.sessionList.mockResolvedValue({
      data: [
        { id: 'recently-updated', time: { created: 1, updated: 100 } },
        { id: 'newer-created', time: { created: 50, updated: 50 } },
      ],
      error: undefined,
    });

    const sessions = await fetchAllOpenCodeSessions(PORT);

    expect(sessions?.map((session) => session.id)).toEqual([
      'recently-updated',
      'newer-created',
    ]);
  });

  it('preserves OpenCode updated-time ordering when listing root sessions', async () => {
    sessionApiMocks.sessionList.mockResolvedValue({
      data: [
        { id: 'active-root', time: { created: 1, updated: 100 } },
        { id: 'newer-root', time: { created: 50, updated: 50 } },
      ],
      error: undefined,
    });

    const sessions = await fetchRootOpenCodeSessions(PORT);

    expect(sessions?.map((session) => session.id)).toEqual([
      'active-root',
      'newer-root',
    ]);
  });

  it('sorts directory-scoped sessions by updated time', async () => {
    sessionApiMocks.sessionList.mockResolvedValue({
      data: [
        { id: 'recently-updated', time: { created: 1, updated: 100 } },
        { id: 'newer-created', time: { created: 50, updated: 50 } },
      ],
      error: undefined,
    });

    const { fetchSessionsForDirectory } = await import('./session');
    const sessions = await fetchSessionsForDirectory(PORT, '/repo');

    expect(sessions?.map((session) => session.id)).toEqual([
      'recently-updated',
      'newer-created',
    ]);
    expect(sessionApiMocks.sessionList).toHaveBeenCalledWith(
      PORT,
      { roots: undefined },
      { directory: '/repo', signal: expect.any(AbortSignal) },
    );
  });

  it('sorts merged fallback-directory sessions by updated time', async () => {
    sessionApiMocks.sessionList
      .mockResolvedValueOnce({
        data: [{ id: 'unscoped', time: { created: 50, updated: 50 } }],
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'scoped', time: { created: 1, updated: 100 } }],
        error: undefined,
      });

    const sessions = await fetchAllOpenCodeSessions(PORT, ['/repo']);

    expect(sessions?.map((session) => session.id)).toEqual([
      'scoped',
      'unscoped',
    ]);
  });

  it('passes roots and limit through to unscoped and scoped session list requests', async () => {
    sessionApiMocks.sessionList.mockResolvedValue({
      data: [],
      error: undefined,
    });

    await fetchAllOpenCodeSessions(PORT, ['/repo'], { roots: true, limit: 50 });

    expect(sessionApiMocks.sessionList).toHaveBeenNthCalledWith(
      1,
      PORT,
      { roots: true, limit: 50 },
      { directory: undefined, signal: expect.any(AbortSignal) },
    );
    expect(sessionApiMocks.sessionList).toHaveBeenNthCalledWith(
      2,
      PORT,
      { roots: true, limit: 50 },
      { directory: '/repo', signal: expect.any(AbortSignal) },
    );
  });
});
