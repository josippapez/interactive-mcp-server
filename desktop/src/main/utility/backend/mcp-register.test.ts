import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  mcpAdd: vi.fn(),
  mcpStatus: vi.fn(),
  configGet: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

import { registerMcpWithOpenCode } from './mcp-register';

const APP_PORT = 3100;
const OPENCODE_PORT = 4096;

beforeEach(() => {
  sdkMocks.getClient.mockReset();
  sdkMocks.mcpAdd.mockReset();
  sdkMocks.mcpStatus.mockReset();
  sdkMocks.configGet.mockReset();
  sdkMocks.getClient.mockReturnValue({
    config: { get: sdkMocks.configGet },
    mcp: {
      add: sdkMocks.mcpAdd,
      status: sdkMocks.mcpStatus,
    },
  });
});

describe('registerMcpWithOpenCode', () => {
  it('skips mcp.add when the desktop MCP entry is already connected', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        'interactive-desktop': { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'interactive-desktop': {
            type: 'remote',
            url: `http://localhost:${APP_PORT}/mcp`,
          },
        },
      },
      error: undefined,
    });

    const result = await registerMcpWithOpenCode({
      appPort: APP_PORT,
      openCodePort: OPENCODE_PORT,
    });

    expect(result).toEqual({ status: 'registered' });
    expect(sdkMocks.mcpStatus).toHaveBeenCalledOnce();
    expect(sdkMocks.mcpAdd).not.toHaveBeenCalled();
  });

  it('falls back to mcp.add when status preflight does not report connected', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        'interactive-desktop': { status: 'disconnected' },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const result = await registerMcpWithOpenCode({
      appPort: APP_PORT,
      openCodePort: OPENCODE_PORT,
    });

    expect(result).toEqual({ status: 'registered' });
    expect(sdkMocks.mcpAdd).toHaveBeenCalledOnce();
  });

  it('falls back to mcp.add when the connected entry points at another URL', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        'interactive-desktop': { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'interactive-desktop': {
            type: 'remote',
            url: 'http://localhost:9999/mcp',
          },
        },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const result = await registerMcpWithOpenCode({
      appPort: APP_PORT,
      openCodePort: OPENCODE_PORT,
    });

    expect(result).toEqual({ status: 'registered' });
    expect(sdkMocks.mcpAdd).toHaveBeenCalledOnce();
  });

  it('falls back to mcp.add when status preflight fails', async () => {
    sdkMocks.mcpStatus.mockRejectedValue(new Error('status unavailable'));
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const result = await registerMcpWithOpenCode({
      appPort: APP_PORT,
      openCodePort: OPENCODE_PORT,
    });

    expect(result).toEqual({ status: 'registered' });
    expect(sdkMocks.mcpAdd).toHaveBeenCalledOnce();
  });
});
