import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  expandOpenCodeSessionTree: vi.fn(),
  fetchRootSessionsForDirectory: vi.fn(),
  fetchVcsInfo: vi.fn(),
  getAllRegisteredConnections: vi.fn(),
  getPinnedProjects: vi.fn(),
  startMissingIndexForBaseDirectory: vi.fn(),
}));

vi.mock('./database', () => ({
  getAllRegisteredConnections: mocks.getAllRegisteredConnections,
  getPinnedProjects: mocks.getPinnedProjects,
}));

vi.mock('./session', () => ({
  expandOpenCodeSessionTree: mocks.expandOpenCodeSessionTree,
  fetchRootSessionsForDirectory: mocks.fetchRootSessionsForDirectory,
}));

vi.mock('./vcs-api', () => ({
  fetchVcsInfo: mocks.fetchVcsInfo,
}));

vi.mock('./repository-index/autostart', () => ({
  startMissingIndexForBaseDirectory: mocks.startMissingIndexForBaseDirectory,
}));

import {
  fetchSessionTree,
  increaseSessionTreeLimit,
  startSessionTreeService,
  stopSessionTreeService,
} from './session-tree-service';

const PORT = 4321;

beforeEach(() => {
  stopSessionTreeService();
  mocks.fetchRootSessionsForDirectory.mockReset();
  mocks.expandOpenCodeSessionTree.mockReset();
  mocks.fetchVcsInfo.mockReset();
  mocks.getAllRegisteredConnections.mockReset();
  mocks.getPinnedProjects.mockReset();
  mocks.startMissingIndexForBaseDirectory.mockReset();
  mocks.fetchRootSessionsForDirectory.mockResolvedValue([]);
  mocks.expandOpenCodeSessionTree.mockImplementation(
    async (_port: number, roots: unknown[]) => roots,
  );
  mocks.fetchVcsInfo.mockResolvedValue(null);
  mocks.getAllRegisteredConnections.mockReturnValue([]);
  mocks.getPinnedProjects.mockReturnValue([]);
  startSessionTreeService(() => PORT);
});

describe('fetchSessionTree', () => {
  it('fetches only pinned directories initially so pagination is per pinned folder', async () => {
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
    mocks.fetchRootSessionsForDirectory.mockResolvedValue([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Child',
        directory: '/child-repo',
      },
    ]);

    await fetchSessionTree();

    expect(mocks.fetchRootSessionsForDirectory).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRootSessionsForDirectory).toHaveBeenCalledWith(
      PORT,
      '/pinned-repo',
      10,
      false,
    );
  });

  it('returns per-project load-more metadata and increases limit by five', async () => {
    mocks.getPinnedProjects.mockReturnValue([{ path: '/repo' }]);
    mocks.fetchRootSessionsForDirectory.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `ses_${index}`,
        title: `Session ${index}`,
        directory: '/repo',
        time: { created: index, updated: index },
      })),
    );

    const first = await fetchSessionTree();

    expect(first?.limit).toBe(10);
    expect(first?.hasMore).toBe(true);
    expect(first?.projectPages).toEqual([
      { path: '/repo', limit: 10, hasMore: true, archived: false },
    ]);

    increaseSessionTreeLimit('/repo');
    await fetchSessionTree();

    expect(mocks.fetchRootSessionsForDirectory).toHaveBeenLastCalledWith(
      PORT,
      '/repo',
      15,
      false,
    );
  });

  it('includes newly registered child sessions before REST child traversal catches up', async () => {
    mocks.getPinnedProjects.mockReturnValue([{ path: '/repo' }]);
    mocks.getAllRegisteredConnections.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_parent',
        connectionId: null,
        channelName: 'Parent',
        projectName: 'OpenCode',
        baseDirectory: '/repo',
        idFilePath: '',
        parentSessionId: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        providerType: 'opencode',
        providerSessionId: 'ses_child',
        connectionId: null,
        channelName: 'Background subagent',
        projectName: 'OpenCode',
        baseDirectory: '/repo',
        idFilePath: '',
        parentSessionId: 'ses_parent',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    mocks.fetchRootSessionsForDirectory.mockResolvedValue([
      {
        id: 'ses_parent',
        parentID: null,
        title: 'Parent',
        directory: '/repo',
        time: { created: 1, updated: 1 },
      },
    ]);

    const result = await fetchSessionTree();

    expect(result?.nodes.map((node) => node.providerSessionId)).toEqual([
      'ses_parent',
      'ses_child',
    ]);
    expect(
      result?.nodes.find((node) => node.providerSessionId === 'ses_child'),
    ).toMatchObject({
      openCodeParentId: 'ses_parent',
      title: 'Background subagent',
      directory: '/repo',
      baseDirectory: '/repo',
      depth: 1,
      providerType: 'opencode',
    });
  });

  it('does not reinsert registered children under archived parents in the active tree', async () => {
    mocks.getPinnedProjects.mockReturnValue([{ path: '/repo' }]);
    mocks.getAllRegisteredConnections.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_parent',
        connectionId: null,
        channelName: 'Parent',
        projectName: 'OpenCode',
        baseDirectory: '/repo',
        idFilePath: '',
        parentSessionId: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        providerType: 'opencode',
        providerSessionId: 'ses_child',
        connectionId: null,
        channelName: 'Background subagent',
        projectName: 'OpenCode',
        baseDirectory: '/repo',
        idFilePath: '',
        parentSessionId: 'ses_parent',
        createdAt: '',
        updatedAt: '',
      },
    ]);
    mocks.fetchRootSessionsForDirectory.mockResolvedValue([
      {
        id: 'ses_parent',
        parentID: null,
        title: 'Parent',
        directory: '/repo',
        time: { created: 1, updated: 1, archived: 2 },
      },
    ]);

    const result = await fetchSessionTree();

    expect(result?.nodes).toEqual([]);
  });
});
