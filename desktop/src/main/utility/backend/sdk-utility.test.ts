import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  fileList: vi.fn(),
  fileStatus: vi.fn(),
  findFiles: vi.fn(),
  getClient: vi.fn(),
  pathGet: vi.fn(),
  projectCurrent: vi.fn(),
  toolIds: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

import {
  fetchOpenCodeUtilitySnapshot,
  findOpenCodeFiles,
  listOpenCodeFiles,
} from './sdk-utility';

const PORT = 4321;
const BASE_DIR = '/repo';

beforeEach(() => {
  for (const mock of Object.values(sdkMocks)) mock.mockReset();
  sdkMocks.getClient.mockReturnValue({
    file: { list: sdkMocks.fileList, status: sdkMocks.fileStatus },
    find: { files: sdkMocks.findFiles },
    path: { get: sdkMocks.pathGet },
    project: { current: sdkMocks.projectCurrent },
    tool: { ids: sdkMocks.toolIds },
  });
});

describe('sdk-utility', () => {
  it('returns a directory-scoped utility snapshot', async () => {
    sdkMocks.pathGet.mockResolvedValue({
      data: {
        home: '/home',
        state: '/state',
        config: '/config',
        worktree: BASE_DIR,
        directory: BASE_DIR,
      },
      error: undefined,
    });
    sdkMocks.projectCurrent.mockResolvedValue({
      data: {
        id: 'proj',
        worktree: BASE_DIR,
        time: { created: 1, updated: 2 },
        sandboxes: [],
      },
      error: undefined,
    });
    sdkMocks.toolIds.mockResolvedValue({
      data: ['read', 'write'],
      error: undefined,
    });
    sdkMocks.fileStatus.mockResolvedValue({
      data: [
        { path: 'src/index.ts', added: 1, removed: 0, status: 'modified' },
      ],
      error: undefined,
    });

    const result = await fetchOpenCodeUtilitySnapshot(PORT, BASE_DIR);

    expect(result.toolIds).toEqual(['read', 'write']);
    expect(result.path?.directory).toBe(BASE_DIR);
    expect(result.project?.id).toBe('proj');
    expect(result.fileStatus).toHaveLength(1);
    expect(sdkMocks.getClient).toHaveBeenCalledWith(PORT, BASE_DIR);
  });

  it('uses SDK find.files and file.list for read-only file discovery', async () => {
    sdkMocks.findFiles.mockResolvedValue({
      data: ['src/index.ts'],
      error: undefined,
    });
    sdkMocks.fileList.mockResolvedValue({
      data: [
        {
          name: 'index.ts',
          path: 'src/index.ts',
          absolute: `${BASE_DIR}/src/index.ts`,
          type: 'file',
          ignored: false,
        },
      ],
      error: undefined,
    });

    await expect(
      findOpenCodeFiles(PORT, { baseDirectory: BASE_DIR, query: 'index' }),
    ).resolves.toEqual(['src/index.ts']);
    await expect(
      listOpenCodeFiles(PORT, { baseDirectory: BASE_DIR, path: 'src' }),
    ).resolves.toEqual([
      {
        name: 'index.ts',
        path: 'src/index.ts',
        absolute: `${BASE_DIR}/src/index.ts`,
        type: 'file',
        ignored: false,
      },
    ]);
  });
});
