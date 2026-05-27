import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  mcpAdd: vi.fn(),
  mcpStatus: vi.fn(),
  mcpClientConnect: vi.fn(),
  mcpClientClose: vi.fn(),
  mcpClientListTools: vi.fn(),
  mcpClientConstructor: vi.fn(),
  sseTransport: vi.fn(),
  stdioTransport: vi.fn(),
  streamableHttpTransport: vi.fn(),
  toolList: vi.fn(),
  toolIds: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: sdkMocks.mcpClientConstructor,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: sdkMocks.sseTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: sdkMocks.stdioTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: sdkMocks.streamableHttpTransport,
}));

import { fetchMcpStatus, matchMcpToolIdToServer } from './mcp-status';

const PORT = 4321;
const DIRECTORY = '/repo';

beforeEach(() => {
  sdkMocks.configGet.mockReset();
  sdkMocks.mcpClientClose.mockReset();
  sdkMocks.mcpClientConnect.mockReset();
  sdkMocks.mcpClientConstructor.mockReset();
  sdkMocks.mcpClientListTools.mockReset();
  sdkMocks.mcpAdd.mockReset();
  sdkMocks.mcpStatus.mockReset();
  sdkMocks.sseTransport.mockReset();
  sdkMocks.stdioTransport.mockReset();
  sdkMocks.streamableHttpTransport.mockReset();
  sdkMocks.toolList.mockReset();
  sdkMocks.toolIds.mockReset();
  sdkMocks.getClient.mockReset();
  sdkMocks.getClient.mockReturnValue({
    config: { get: sdkMocks.configGet },
    mcp: { add: sdkMocks.mcpAdd, status: sdkMocks.mcpStatus },
    tool: { ids: sdkMocks.toolIds, list: sdkMocks.toolList },
  });
  sdkMocks.toolList.mockResolvedValue({ data: [], error: undefined });
  sdkMocks.toolIds.mockResolvedValue({ data: [], error: undefined });
  sdkMocks.mcpClientConnect.mockResolvedValue(undefined);
  sdkMocks.mcpClientClose.mockResolvedValue(undefined);
  sdkMocks.mcpClientListTools.mockResolvedValue({ tools: [] });
  sdkMocks.mcpClientConstructor.mockImplementation(function () {
    return {
      close: sdkMocks.mcpClientClose,
      connect: sdkMocks.mcpClientConnect,
      listTools: sdkMocks.mcpClientListTools,
    };
  });
  sdkMocks.sseTransport.mockImplementation(function (url: string) {
    return { type: 'sse', url };
  });
  sdkMocks.stdioTransport.mockImplementation(function (options: unknown) {
    return {
      type: 'stdio',
      options,
    };
  });
  sdkMocks.streamableHttpTransport.mockImplementation(function (url: string) {
    return {
      type: 'streamable-http',
      url,
    };
  });
});

describe('matchMcpToolIdToServer', () => {
  it('matches OpenCode double-underscore MCP tool IDs to their server', () => {
    expect(matchMcpToolIdToServer('mcp__github__search_repos', 'github')).toBe(
      'search_repos',
    );
  });

  it('matches namespace separator MCP tool IDs to their server', () => {
    expect(matchMcpToolIdToServer('github::search_repos', 'github')).toBe(
      'search_repos',
    );
  });

  it('matches underscore-normalized MCP tool IDs for hyphenated servers', () => {
    expect(
      matchMcpToolIdToServer(
        'mcp__interactive_desktop__manage_memories',
        'interactive-desktop',
      ),
    ).toBe('manage_memories');
  });

  it('matches double-underscore MCP tool IDs without a leading mcp namespace', () => {
    expect(
      matchMcpToolIdToServer(
        'interactive_desktop__manage_memories',
        'interactive-desktop',
      ),
    ).toBe('manage_memories');
  });

  it('matches single-underscore MCP tool IDs for hyphenated servers', () => {
    expect(
      matchMcpToolIdToServer(
        'interactive_desktop_manage_memories',
        'interactive-desktop',
      ),
    ).toBe('manage_memories');
  });

  it('matches normalized MCP tool IDs for mixed-case servers with spaces', () => {
    expect(
      matchMcpToolIdToServer(
        'mcp__framelink_figma__get_figma_data',
        'Framelink Figma',
      ),
    ).toBe('get_figma_data');
  });

  it('matches lowercase MCP tool IDs for mixed-case servers', () => {
    expect(
      matchMcpToolIdToServer('context7_resolve_library_id', 'Context7'),
    ).toBe('resolve_library_id');
  });

  it('does not match tools for another server', () => {
    expect(
      matchMcpToolIdToServer('mcp__linear__list_issues', 'github'),
    ).toBeNull();
  });
});

describe('fetchMcpStatus', () => {
  it('does not dynamically register configured MCPs that are missing from native status', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        existing: { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          existing: { type: 'local', command: ['npx', 'existing'] },
          added: { type: 'remote', url: 'http://localhost:3000/mcp' },
          disabled: {
            type: 'local',
            command: ['npx', 'disabled'],
            enabled: false,
          },
        },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const result = await fetchMcpStatus(PORT, DIRECTORY);

    expect(sdkMocks.mcpStatus).toHaveBeenCalledWith(
      { directory: DIRECTORY },
      expect.any(Object),
    );
    expect(sdkMocks.configGet).toHaveBeenCalledWith(
      { directory: DIRECTORY },
      expect.any(Object),
    );
    expect(sdkMocks.mcpAdd).not.toHaveBeenCalled();
    expect(sdkMocks.mcpStatus).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.servers?.map((server) => server.name)).toEqual(['existing']);
  });

  it('maps tool IDs onto returned MCP servers', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        'interactive-desktop': { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'interactive-desktop': { type: 'local', command: ['npx', 'server'] },
        },
      },
      error: undefined,
    });
    sdkMocks.toolIds.mockResolvedValue({
      data: ['interactive_desktop_manage_memories'],
      error: undefined,
    });

    const result = await fetchMcpStatus(PORT, DIRECTORY);

    expect(result.ok).toBe(true);
    expect(result.servers?.[0]?.tools).toEqual([{ name: 'manage_memories' }]);
  });

  it('maps normalized mixed-case server tool IDs onto returned MCP servers', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        Context7: { status: 'connected' },
        'Framelink Figma': { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          Context7: { type: 'local', command: ['npx', 'context7'] },
          'Framelink Figma': { type: 'local', command: ['npx', 'figma'] },
        },
      },
      error: undefined,
    });
    sdkMocks.toolIds.mockResolvedValue({
      data: ['context7_resolve_library_id', 'framelink_figma_get_figma_data'],
      error: undefined,
    });

    const result = await fetchMcpStatus(PORT, DIRECTORY);

    expect(result.ok).toBe(true);
    expect(result.servers?.map((server) => server.tools)).toEqual([
      [{ name: 'resolve_library_id' }],
      [{ name: 'get_figma_data' }],
    ]);
  });

  it('uses model-scoped tool list when provider and model are available', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        'Framelink Figma': { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'Framelink Figma': { type: 'local', command: ['npx', 'figma'] },
        },
      },
      error: undefined,
    });
    sdkMocks.toolList.mockResolvedValue({
      data: [
        {
          id: 'framelink_figma_get_figma_data',
          description: 'Fetch Figma data',
          parameters: {},
        },
      ],
      error: undefined,
    });
    sdkMocks.toolIds.mockResolvedValue({ data: [], error: undefined });

    const result = await fetchMcpStatus(PORT, DIRECTORY, {
      providerId: 'github-copilot',
      modelId: 'gpt-5.5',
    });

    expect(sdkMocks.toolList).toHaveBeenCalledWith(
      {
        directory: DIRECTORY,
        provider: 'github-copilot',
        model: 'gpt-5.5',
      },
      expect.any(Object),
    );
    expect(result.ok).toBe(true);
    expect(result.servers?.[0]?.tools).toEqual([
      { name: 'get_figma_data', description: 'Fetch Figma data' },
    ]);
  });

  it('falls back to listing tools directly from configured MCP servers', async () => {
    sdkMocks.mcpStatus.mockResolvedValue({
      data: {
        'Framelink Figma': { status: 'connected' },
      },
      error: undefined,
    });
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'Framelink Figma': { type: 'local', command: ['npx', 'figma'] },
        },
      },
      error: undefined,
    });
    sdkMocks.mcpClientListTools.mockResolvedValue({
      tools: [{ name: 'get_figma_data', description: 'Fetch Figma data' }],
    });

    const result = await fetchMcpStatus(PORT, DIRECTORY);

    expect(sdkMocks.stdioTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['figma'],
        command: 'npx',
        cwd: DIRECTORY,
      }),
    );
    expect(sdkMocks.mcpClientConnect).toHaveBeenCalledOnce();
    expect(sdkMocks.mcpClientClose).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.servers?.[0]?.tools).toEqual([
      { name: 'get_figma_data', description: 'Fetch Figma data' },
    ]);
  });
});
