import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectMcp,
  disconnectMcp,
  fetchMcpStatus,
  registerMcp,
} from './mcp-status';
import { _resetClientFactory, _setClientFactory } from './sdk-client';

describe('opencode mcp-status', () => {
  beforeEach(() => {
    _resetClientFactory();
  });

  it('uses a directory-scoped client for MCP status and operations', async () => {
    const statusMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const connectMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const disconnectMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const addMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });

    _setClientFactory((_port, directory) => {
      expect(directory).toBe('/repo');
      return {
        mcp: {
          status: statusMock,
          connect: connectMock,
          disconnect: disconnectMock,
          add: addMock,
        },
      } as never;
    });

    await fetchMcpStatus(4096, '/repo');
    await connectMcp(4096, 'server-a', '/repo');
    await disconnectMcp(4096, 'server-a', '/repo');
    await registerMcp(
      4096,
      'server-a',
      { type: 'remote', url: 'http://localhost:1234/mcp' },
      '/repo',
    );

    expect(statusMock).toHaveBeenCalledWith({});
    expect(connectMock).toHaveBeenCalledWith({ path: { name: 'server-a' } });
    expect(disconnectMock).toHaveBeenCalledWith({ path: { name: 'server-a' } });
    expect(addMock).toHaveBeenCalledWith({
      body: {
        name: 'server-a',
        config: {
          type: 'remote',
          url: 'http://localhost:1234/mcp',
          timeout: undefined,
        },
      },
    });
  });
});
