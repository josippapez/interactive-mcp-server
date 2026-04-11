import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../database', () => ({
  getAllRegisteredConnections: vi.fn(),
  deleteRegisteredConnection: vi.fn(),
}));

vi.mock('../opencode/session', () => ({
  fetchAllOpenCodeSessions: vi.fn(),
}));

import { reconcileSessionConnections } from './reconnect';
import {
  getAllRegisteredConnections,
  deleteRegisteredConnection,
} from '../database';
import { fetchAllOpenCodeSessions } from '../opencode/session';

const mockGetAll = getAllRegisteredConnections as Mock;
const mockDelete = deleteRegisteredConnection as Mock;
const mockFetchSessions = fetchAllOpenCodeSessions as Mock;

function makeConnection(
  overrides: Partial<{
    connectionId: string;
    channelName: string;
    projectName: string;
    baseDirectory: string | null;
    idFilePath: string;
    openCodeSessionId: string | null;
    parentSessionId: string | null;
    createdAt: string;
    updatedAt: string;
  }> = {},
) {
  return {
    connectionId: overrides.connectionId ?? 'conn-1',
    channelName: overrides.channelName ?? 'agent-1',
    projectName: overrides.projectName ?? 'project-1',
    baseDirectory:
      'baseDirectory' in overrides ? overrides.baseDirectory : '/tmp/proj',
    idFilePath: overrides.idFilePath ?? '/tmp/imcp-agent-1.json',
    openCodeSessionId:
      'openCodeSessionId' in overrides
        ? overrides.openCodeSessionId
        : 'oc-session-1',
    parentSessionId: overrides.parentSessionId ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00Z',
  };
}

describe('reconcileSessionConnections', () => {
  beforeEach(() => {
    mockGetAll.mockReset();
    mockDelete.mockReset();
    mockFetchSessions.mockReset();
  });

  it('cleans stale connections where OpenCode session no longer exists', async () => {
    mockFetchSessions.mockResolvedValueOnce([
      { id: 'oc-session-alive', parentID: null },
    ]);
    mockGetAll.mockReturnValueOnce([
      makeConnection({
        connectionId: 'conn-stale',
        openCodeSessionId: 'oc-session-gone',
      }),
      makeConnection({
        connectionId: 'conn-alive',
        openCodeSessionId: 'oc-session-alive',
      }),
    ]);

    const result = await reconcileSessionConnections(4096);

    expect(result).toEqual({ matched: 1, cleaned: 1, total: 2 });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    // deleteRegisteredConnection now takes the openCodeSessionId (PK), not connectionId
    expect(mockDelete).toHaveBeenCalledWith('oc-session-gone');
  });

  it('keeps connections that match live OpenCode sessions', async () => {
    mockFetchSessions.mockResolvedValueOnce([
      { id: 'oc-session-1', parentID: null },
      { id: 'oc-session-2', parentID: 'oc-session-1' },
    ]);
    mockGetAll.mockReturnValueOnce([
      makeConnection({
        connectionId: 'conn-1',
        openCodeSessionId: 'oc-session-1',
      }),
      makeConnection({
        connectionId: 'conn-2',
        openCodeSessionId: 'oc-session-2',
      }),
    ]);

    const result = await reconcileSessionConnections(4096);

    expect(result).toEqual({ matched: 2, cleaned: 0, total: 2 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns early without cleaning when OpenCode API is unreachable', async () => {
    mockFetchSessions.mockResolvedValueOnce(null);
    mockGetAll.mockReturnValueOnce([
      makeConnection({
        connectionId: 'conn-1',
        openCodeSessionId: 'oc-session-1',
      }),
      makeConnection({
        connectionId: 'conn-2',
        openCodeSessionId: 'oc-session-2',
      }),
    ]);

    const result = await reconcileSessionConnections(4096);

    expect(result).toEqual({ matched: 0, cleaned: 0, total: 2 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('handles empty registered connections list', async () => {
    mockFetchSessions.mockResolvedValueOnce([
      { id: 'oc-session-1', parentID: null },
    ]);
    mockGetAll.mockReturnValueOnce([]);

    const result = await reconcileSessionConnections(4096);

    expect(result).toEqual({ matched: 0, cleaned: 0, total: 0 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('ignores connections without openCodeSessionId (not cleaned)', async () => {
    mockFetchSessions.mockResolvedValueOnce([
      { id: 'oc-session-1', parentID: null },
    ]);
    mockGetAll.mockReturnValueOnce([
      makeConnection({
        connectionId: 'conn-no-session',
        openCodeSessionId: null,
      }),
      makeConnection({
        connectionId: 'conn-with-session',
        openCodeSessionId: 'oc-session-1',
      }),
    ]);

    const result = await reconcileSessionConnections(4096);

    // The connection without openCodeSessionId should be ignored (not counted as matched or cleaned)
    expect(result).toEqual({ matched: 1, cleaned: 0, total: 2 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('passes registered base directories as fallback scope for session fetch', async () => {
    mockFetchSessions.mockResolvedValueOnce([]);
    mockGetAll.mockReturnValueOnce([
      makeConnection({ baseDirectory: '/repo/a' }),
      makeConnection({ connectionId: 'conn-2', baseDirectory: '/repo/b' }),
      makeConnection({ connectionId: 'conn-3', baseDirectory: '/repo/a' }),
      makeConnection({ connectionId: 'conn-4', baseDirectory: null }),
    ]);

    await reconcileSessionConnections(4096);

    expect(mockFetchSessions).toHaveBeenCalledWith(4096, [
      '/repo/a',
      '/repo/b',
    ]);
  });
});
