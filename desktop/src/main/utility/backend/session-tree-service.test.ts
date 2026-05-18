import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAllOpenCodeSessions: vi.fn(),
  fetchVcsInfo: vi.fn(),
  getAllRegisteredConnections: vi.fn(),
  getPinnedProjects: vi.fn(),
}));

vi.mock('./database', () => ({
  getAllRegisteredConnections: mocks.getAllRegisteredConnections,
  getPinnedProjects: mocks.getPinnedProjects,
}));

vi.mock('./session', () => ({
  fetchAllOpenCodeSessions: mocks.fetchAllOpenCodeSessions,
}));

vi.mock('./vcs-api', () => ({
  fetchVcsInfo: mocks.fetchVcsInfo,
}));

import {
  fetchSessionTree,
  startSessionTreeService,
  stopSessionTreeService,
} from './session-tree-service';

const PORT = 4321;

beforeEach(() => {
  stopSessionTreeService();
  mocks.fetchAllOpenCodeSessions.mockReset();
  mocks.fetchVcsInfo.mockReset();
  mocks.getAllRegisteredConnections.mockReset();
  mocks.getPinnedProjects.mockReset();
  mocks.fetchAllOpenCodeSessions.mockResolvedValue([]);
  mocks.fetchVcsInfo.mockResolvedValue(null);
  mocks.getAllRegisteredConnections.mockReturnValue([]);
  mocks.getPinnedProjects.mockReturnValue([]);
  startSessionTreeService(() => PORT);
});

describe('fetchSessionTree', () => {
  it('includes registered OpenCode directories in the session fetch fallback set', async () => {
    mocks.getPinnedProjects.mockReturnValue([{ path: '/pinned-repo' }]);
    mocks.getAllRegisteredConnections.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_parent',
        connectionId: null,
        channelName: 'Parent',
        projectName: 'Parent',
        baseDirectory: '/parent-repo',
        idFilePath: '',
        parentSessionId: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        providerType: 'opencode',
        providerSessionId: 'ses_child',
        connectionId: null,
        channelName: 'Child',
        projectName: 'Child',
        baseDirectory: '/child-repo',
        idFilePath: '',
        parentSessionId: 'ses_parent',
        createdAt: '',
        updatedAt: '',
      },
      {
        providerType: 'standalone',
        providerSessionId: 'standalone',
        connectionId: null,
        channelName: 'Standalone',
        projectName: 'Standalone',
        baseDirectory: '/standalone-repo',
        idFilePath: '',
        parentSessionId: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    mocks.fetchAllOpenCodeSessions.mockResolvedValue([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Child',
        directory: '/child-repo',
      },
    ]);

    await fetchSessionTree();

    expect(mocks.fetchAllOpenCodeSessions).toHaveBeenCalledWith(PORT, [
      '/pinned-repo',
      '/parent-repo',
      '/child-repo',
    ]);
  });
});
