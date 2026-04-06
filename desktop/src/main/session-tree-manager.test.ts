import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('./database', () => ({
  getAllRegisteredConnections: vi.fn(),
}));

vi.mock('./opencode-session', () => ({
  fetchAllOpenCodeSessions: vi.fn(),
}));

import { triggerSessionTreeUpdate } from './session-tree-manager';
import { getAllRegisteredConnections } from './database';
import { fetchAllOpenCodeSessions } from './opencode-session';

const mockGetAllRegisteredConnections = getAllRegisteredConnections as Mock;
const mockFetchAllOpenCodeSessions = fetchAllOpenCodeSessions as Mock;

describe('session-tree-manager', () => {
  beforeEach(() => {
    mockGetAllRegisteredConnections.mockReset();
    mockFetchAllOpenCodeSessions.mockReset();
  });

  it('passes registered base directories as fallback scope when triggering an update', async () => {
    const registeredConnections = [
      {
        connectionId: 'conn-1',
        agentName: 'Agent 1',
        projectName: 'proj',
        baseDirectory: '/repo/a',
        idFilePath: '/tmp/a.json',
        openCodeSessionId: 'ses_1',
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        connectionId: 'conn-2',
        agentName: 'Agent 2',
        projectName: 'proj',
        baseDirectory: '/repo/b',
        idFilePath: '/tmp/b.json',
        openCodeSessionId: 'ses_2',
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        connectionId: 'conn-3',
        agentName: 'Agent 3',
        projectName: 'proj',
        baseDirectory: '/repo/a',
        idFilePath: '/tmp/c.json',
        openCodeSessionId: null,
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        connectionId: 'conn-4',
        agentName: 'Agent 4',
        projectName: 'proj',
        baseDirectory: null,
        idFilePath: '/tmp/d.json',
        openCodeSessionId: null,
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];
    mockGetAllRegisteredConnections.mockReturnValue(registeredConnections);
    mockFetchAllOpenCodeSessions.mockResolvedValueOnce([]);

    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: { send },
    };

    await triggerSessionTreeUpdate(
      () => win as unknown as BrowserWindow,
      () => 4096,
    );

    expect(mockFetchAllOpenCodeSessions).toHaveBeenCalledWith(4096, [
      '/repo/a',
      '/repo/b',
    ]);
    expect(send).toHaveBeenCalledWith('session-tree-updated', []);
  });
});
