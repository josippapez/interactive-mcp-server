import { describe, expect, it, vi, beforeEach } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  mcpAdd: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: sdkMocks.getClient,
}));

import { injectProjectMcps, _resetTrackingForTest } from './mcp-inject';

const PORT = 4321;
const BASE_DIR = '/repo';

beforeEach(() => {
  sdkMocks.configGet.mockReset();
  sdkMocks.mcpAdd.mockReset();
  sdkMocks.getClient.mockReset();
  sdkMocks.getClient.mockReturnValue({
    config: { get: sdkMocks.configGet },
    mcp: { add: sdkMocks.mcpAdd },
  });
  _resetTrackingForTest();
});

describe('injectProjectMcps', () => {
  it('calls config.get with the baseDirectory', async () => {
    sdkMocks.configGet.mockResolvedValue({ data: {}, error: undefined });

    await injectProjectMcps({ baseDirectory: BASE_DIR, openCodePort: PORT });

    expect(sdkMocks.configGet).toHaveBeenCalledOnce();
    const [params] = sdkMocks.configGet.mock.calls[0];
    expect(params).toMatchObject({ directory: BASE_DIR });
  });

  it('calls mcp.add for each MCP entry returned by config.get', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'my-local': { type: 'local', command: ['npx', 'my-mcp'] },
          'my-remote': { type: 'remote', url: 'http://localhost:3000/mcp' },
        },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(sdkMocks.mcpAdd).toHaveBeenCalledTimes(2);
    const addedNames = sdkMocks.mcpAdd.mock.calls.map(
      ([params]: [{ name: string; config: unknown }]) => params.name,
    );
    expect(addedNames).toContain('my-local');
    expect(addedNames).toContain('my-remote');
    expect(summary.configFound).toBe(true);
    expect(summary.injectedMcps).toHaveLength(2);
  });

  it('does not call mcp.add when config has no mcp section', async () => {
    sdkMocks.configGet.mockResolvedValue({ data: {}, error: undefined });

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(sdkMocks.mcpAdd).not.toHaveBeenCalled();
    expect(summary.configFound).toBe(true);
    expect(summary.injectedMcps).toHaveLength(0);
  });

  it('skips disabled MCPs and does not call mcp.add for them', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: {
          'enabled-mcp': { type: 'local', command: ['npx', 'enabled'] },
          'disabled-mcp': {
            type: 'local',
            command: ['npx', 'disabled'],
            enabled: false,
          },
        },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(sdkMocks.mcpAdd).toHaveBeenCalledOnce();
    expect(summary.injectedMcps).toEqual(['enabled-mcp']);
    const skipped = summary.results.find((r) => r.name === 'disabled-mcp');
    expect(skipped?.status).toBe('skipped');
  });

  it('returns configFound: false when config.get throws', async () => {
    sdkMocks.configGet.mockRejectedValue(new Error('network error'));

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(sdkMocks.mcpAdd).not.toHaveBeenCalled();
    expect(summary.configFound).toBe(false);
    expect(summary.parseError).toMatch(/fetch-error/);
  });

  it('returns configFound: false when config.get returns an error response', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: undefined,
      error: { message: 'not found' },
    });

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(sdkMocks.mcpAdd).not.toHaveBeenCalled();
    expect(summary.configFound).toBe(false);
  });

  it('records an error result when mcp.add returns an error', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: { 'bad-mcp': { type: 'local', command: ['npx', 'bad'] } },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({
      data: undefined,
      error: { message: 'bad request' },
    });

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(summary.injectedMcps).toHaveLength(0);
    expect(summary.results[0].status).toBe('error');
  });

  it('uses config.get (not filesystem) to discover MCPs', async () => {
    sdkMocks.configGet.mockResolvedValue({
      data: {
        mcp: { 'sdk-mcp': { type: 'local', command: ['npx', 'sdk-mcp'] } },
      },
      error: undefined,
    });
    sdkMocks.mcpAdd.mockResolvedValue({ data: {}, error: undefined });

    const summary = await injectProjectMcps({
      baseDirectory: BASE_DIR,
      openCodePort: PORT,
    });

    expect(sdkMocks.configGet).toHaveBeenCalled();
    expect(summary.injectedMcps).toContain('sdk-mcp');
  });
});
