import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateMcp,
  callbackMcpAuth,
  connectMcp,
  disconnectMcp,
  fetchMcpStatus,
  registerMcp,
  removeMcpAuth,
  startMcpAuth,
} from './mcp-status';
import { _resetClientFactory, _setClientFactory } from './sdk-client';

describe('opencode mcp-status', () => {
  beforeEach(() => {
    _resetClientFactory();
  });

  it('uses a directory-scoped client for MCP status and operations', async () => {
    const statusMock = vi
      .fn()
      .mockResolvedValue({ data: {}, error: undefined });
    const connectMock = vi
      .fn()
      .mockResolvedValue({ data: {}, error: undefined });
    const disconnectMock = vi
      .fn()
      .mockResolvedValue({ data: {}, error: undefined });
    const addMock = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const authStartMock = vi.fn().mockResolvedValue({
      data: { authorizationUrl: 'https://example.com/oauth' },
      error: undefined,
    });
    const authCallbackMock = vi.fn().mockResolvedValue({
      data: { status: 'connected' },
      error: undefined,
    });
    const authAuthenticateMock = vi.fn().mockResolvedValue({
      data: { status: 'needs_auth' },
      error: undefined,
    });
    const authRemoveMock = vi.fn().mockResolvedValue({
      data: { success: true },
      error: undefined,
    });

    _setClientFactory((_port, directory) => {
      expect(directory).toBe('/repo');
      return {
        mcp: {
          status: statusMock,
          connect: connectMock,
          disconnect: disconnectMock,
          add: addMock,
          auth: {
            start: authStartMock,
            callback: authCallbackMock,
            authenticate: authAuthenticateMock,
            remove: authRemoveMock,
          },
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
    await startMcpAuth(4096, 'server-a', '/repo');
    await callbackMcpAuth(4096, 'server-a', 'oauth-code', '/repo');
    await authenticateMcp(4096, 'server-a', '/repo');
    await removeMcpAuth(4096, 'server-a', '/repo');

    expect(statusMock).toHaveBeenCalledWith(
      {},
      { signal: expect.any(AbortSignal) },
    );
    expect(connectMock).toHaveBeenCalledWith(
      { name: 'server-a' },
      { signal: expect.any(AbortSignal) },
    );
    expect(disconnectMock).toHaveBeenCalledWith(
      { name: 'server-a' },
      { signal: expect.any(AbortSignal) },
    );
    expect(addMock).toHaveBeenCalledWith(
      {
        name: 'server-a',
        config: {
          type: 'remote',
          url: 'http://localhost:1234/mcp',
          timeout: undefined,
        },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(authStartMock).toHaveBeenCalledWith(
      { name: 'server-a' },
      { signal: expect.any(AbortSignal) },
    );
    expect(authCallbackMock).toHaveBeenCalledWith(
      { name: 'server-a', code: 'oauth-code' },
      { signal: expect.any(AbortSignal) },
    );
    expect(authAuthenticateMock).toHaveBeenCalledWith(
      { name: 'server-a' },
      { signal: expect.any(AbortSignal) },
    );
    expect(authRemoveMock).toHaveBeenCalledWith(
      { name: 'server-a' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('preserves needs_auth in MCP status results', async () => {
    _setClientFactory(() => {
      return {
        mcp: {
          status: vi.fn().mockResolvedValue({
            data: {
              remoteAuthServer: { status: 'needs_auth' },
            },
            error: undefined,
          }),
        },
      } as never;
    });

    const result = await fetchMcpStatus(4096, '/repo');

    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: 'remoteAuthServer',
          type: 'remote',
          status: 'needs_auth',
          error: undefined,
          url: undefined,
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
      ],
    });
  });

  it('normalizes richer SDK MCP status literals for the desktop payload', async () => {
    _setClientFactory(() => {
      return {
        mcp: {
          status: vi.fn().mockResolvedValue({
            data: {
              connectingServer: { status: 'connecting' },
              disconnectedServer: { status: 'disconnected' },
              errorServer: {
                status: 'error',
                error: 'Connection refused',
              },
            },
            error: undefined,
          }),
        },
      } as never;
    });

    const result = await fetchMcpStatus(4096, '/repo');

    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: 'connectingServer',
          type: 'local',
          status: 'connecting',
          error: undefined,
          url: undefined,
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
        {
          name: 'disconnectedServer',
          type: 'local',
          status: 'disconnected',
          error: undefined,
          url: undefined,
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
        {
          name: 'errorServer',
          type: 'local',
          status: 'error',
          error: 'Connection refused',
          url: undefined,
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
      ],
    });
  });

  it('preserves needs_client_registration as a first-class status', async () => {
    _setClientFactory(() => {
      return {
        mcp: {
          status: vi.fn().mockResolvedValue({
            data: {
              oauthServer: {
                status: 'needs_client_registration',
                error: 'Missing client_id',
              },
            },
            error: undefined,
          }),
        },
        config: {
          get: vi.fn().mockResolvedValue({
            data: {
              mcp: {
                oauthServer: {
                  type: 'remote',
                  url: 'https://example.com/mcp',
                  oauth: {},
                },
              },
            },
            error: undefined,
          }),
        },
      } as never;
    });

    const result = await fetchMcpStatus(4096, '/repo');

    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: 'oauthServer',
          type: 'remote',
          status: 'needs_client_registration',
          error: 'Missing client_id',
          url: 'https://example.com/mcp',
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
      ],
    });
  });

  it('merges MCP config metadata into fetched status when available', async () => {
    _setClientFactory(() => {
      return {
        mcp: {
          status: vi.fn().mockResolvedValue({
            data: {
              remoteServer: { status: 'needs_auth' },
              localServer: { status: 'connected' },
            },
            error: undefined,
          }),
        },
        config: {
          get: vi.fn().mockResolvedValue({
            data: {
              mcp: {
                remoteServer: {
                  type: 'remote',
                  url: 'https://example.com/mcp',
                },
                localServer: {
                  type: 'local',
                  command: ['npx', '-y', '@scope/server'],
                  environment: {
                    FOO: 'bar',
                    BAZ: 'qux',
                  },
                },
              },
            },
            error: undefined,
          }),
        },
      } as never;
    });

    const result = await fetchMcpStatus(4096, '/repo');

    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: 'remoteServer',
          type: 'remote',
          status: 'needs_auth',
          error: undefined,
          url: 'https://example.com/mcp',
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
        {
          name: 'localServer',
          type: 'local',
          status: 'connected',
          error: undefined,
          url: undefined,
          command: ['npx', '-y', '@scope/server'],
          environmentKeys: ['FOO', 'BAZ'],
          tools: undefined,
          resources: undefined,
          prompts: undefined,
        },
      ],
    });
  });
});
