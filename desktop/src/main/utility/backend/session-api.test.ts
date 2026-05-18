import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkClientMocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  eventSubscribe: vi.fn(),
  v2SessionList: vi.fn(),
  v2ModelList: vi.fn(),
  worktreeList: vi.fn(),
  workspaceList: vi.fn(),
  syncHistoryList: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkClientMocks.getClient,
}));

import { sessionWait } from './session-api';

beforeEach(() => {
  sdkClientMocks.getClient.mockReset();
  sdkClientMocks.eventSubscribe.mockReset();
  sdkClientMocks.v2SessionList.mockReset();
  sdkClientMocks.v2ModelList.mockReset();
  sdkClientMocks.worktreeList.mockReset();
  sdkClientMocks.workspaceList.mockReset();
  sdkClientMocks.syncHistoryList.mockReset();
  sdkClientMocks.wait.mockReset();
  sdkClientMocks.wait.mockResolvedValue({ data: undefined, error: undefined });
  sdkClientMocks.getClient.mockReturnValue({
    event: {
      subscribe: sdkClientMocks.eventSubscribe,
    },
    v2: {
      session: {
        list: sdkClientMocks.v2SessionList,
        wait: sdkClientMocks.wait,
      },
      model: {
        list: sdkClientMocks.v2ModelList,
      },
    },
    worktree: {
      list: sdkClientMocks.worktreeList,
    },
    experimental: {
      workspace: {
        list: sdkClientMocks.workspaceList,
      },
    },
    sync: {
      history: {
        list: sdkClientMocks.syncHistoryList,
      },
    },
  });
});

describe('sessionWait', () => {
  it('uses the v2 SDK wait endpoint with directory scoping', async () => {
    const signal = AbortSignal.timeout(1000);

    await sessionWait(4096, 'ses_child', {
      directory: '/repo',
      signal,
    });

    expect(sdkClientMocks.getClient).toHaveBeenCalledWith(
      4096,
      '/repo',
      undefined,
    );
    expect(sdkClientMocks.wait).toHaveBeenCalledWith(
      { sessionID: 'ses_child', directory: '/repo' },
      { signal },
    );
  });
});

describe('v2 and experimental wrappers', () => {
  it('uses v2 session list with directory and experimental workspace client scoping', async () => {
    const { v2SessionList } = await import('./session-api');

    await v2SessionList(
      4096,
      { roots: true, limit: 20 },
      { directory: '/repo', experimentalWorkspaceId: 'workspace-a' },
    );

    expect(sdkClientMocks.getClient).toHaveBeenCalledWith(
      4096,
      '/repo',
      'workspace-a',
    );
    expect(sdkClientMocks.v2SessionList).toHaveBeenCalledWith(
      { roots: true, limit: 20, directory: '/repo' },
      undefined,
    );
  });

  it('wraps v2 model, worktree, workspace, and sync SDK surfaces', async () => {
    const {
      experimentalWorkspaceList,
      syncHistoryList,
      v2ModelList,
      worktreeList,
    } = await import('./session-api');

    await v2ModelList(4096, { directory: '/repo' });
    await worktreeList(4096, { directory: '/repo' });
    await experimentalWorkspaceList(4096, { directory: '/repo' });
    await syncHistoryList(4096, { ses_123: 1 }, { directory: '/repo' });

    expect(sdkClientMocks.v2ModelList).toHaveBeenCalledWith(
      { location: { directory: '/repo', workspace: undefined } },
      undefined,
    );
    expect(sdkClientMocks.worktreeList).toHaveBeenCalledWith(
      { directory: '/repo' },
      undefined,
    );
    expect(sdkClientMocks.workspaceList).toHaveBeenCalledWith(
      { directory: '/repo' },
      undefined,
    );
    expect(sdkClientMocks.syncHistoryList).toHaveBeenCalledWith(
      { body: { ses_123: 1 }, directory: '/repo' },
      undefined,
    );
  });
});
