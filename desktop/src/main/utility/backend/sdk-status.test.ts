import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  formatterStatus: vi.fn(),
  getClient: vi.fn(),
  lspStatus: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

import { fetchOpenCodeSdkStatus } from './sdk-status';

const PORT = 4321;
const BASE_DIR = '/repo';

beforeEach(() => {
  sdkMocks.formatterStatus.mockReset();
  sdkMocks.getClient.mockReset();
  sdkMocks.lspStatus.mockReset();
  sdkMocks.getClient.mockReturnValue({
    formatter: { status: sdkMocks.formatterStatus },
    lsp: { status: sdkMocks.lspStatus },
  });
});

describe('fetchOpenCodeSdkStatus', () => {
  it('returns directory-scoped LSP and formatter status from the SDK', async () => {
    sdkMocks.lspStatus.mockResolvedValue({
      data: [
        {
          id: 'tsserver',
          name: 'TypeScript',
          root: BASE_DIR,
          status: 'connected',
        },
      ],
      error: undefined,
    });
    sdkMocks.formatterStatus.mockResolvedValue({
      data: [{ name: 'prettier', extensions: ['ts'], enabled: true }],
      error: undefined,
    });

    await expect(fetchOpenCodeSdkStatus(PORT, BASE_DIR)).resolves.toEqual({
      lsp: [
        {
          id: 'tsserver',
          name: 'TypeScript',
          root: BASE_DIR,
          status: 'connected',
        },
      ],
      formatter: [{ name: 'prettier', extensions: ['ts'], enabled: true }],
    });
    expect(sdkMocks.getClient).toHaveBeenCalledWith(PORT, BASE_DIR);
    expect(sdkMocks.lspStatus).toHaveBeenCalledWith(
      { directory: BASE_DIR },
      expect.any(Object),
    );
    expect(sdkMocks.formatterStatus).toHaveBeenCalledWith(
      { directory: BASE_DIR },
      expect.any(Object),
    );
  });
});
