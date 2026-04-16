import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import {
  registerMcpAcrossReachablePorts,
  registerMcpWithOpenCode,
  registerMcpWithRetry,
  type McpRegistrationResult,
} from './mcp-register';
import { _setClientFactory, _resetClientFactory } from './sdk-client';

// Mock SDK client
const mockMcpAdd = vi.fn();

function createMockClient() {
  return {
    mcp: {
      add: mockMcpAdd,
    },
  } as any;
}

describe('opencode-mcp-register', () => {
  beforeEach(() => {
    mockMcpAdd.mockReset();
    _setClientFactory(() => createMockClient());
  });

  afterEach(() => {
    _resetClientFactory();
  });

  it('registers the desktop MCP server via SDK client.mcp.add()', async () => {
    mockMcpAdd.mockResolvedValueOnce({ data: { status: 'ready' } });

    const result = await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result.status).toBe('registered');

    // Verify the correct body was sent
    expect(mockMcpAdd).toHaveBeenCalledWith({
      body: {
        name: 'interactive-desktop',
        config: {
          type: 'remote',
          url: 'http://localhost:3100/mcp',
          timeout: 1260000,
        },
      },
    });
  });

  it('derives the remote MCP timeout from the prompt timeout setting', async () => {
    mockMcpAdd.mockResolvedValueOnce({ data: { status: 'ready' } });

    await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
      promptTimeoutSeconds: 1201,
    });

    const call = mockMcpAdd.mock.calls[0][0];
    expect(call.body.config.timeout).toBe(1261000);
  });

  it('returns unreachable when OpenCode is not running', async () => {
    mockMcpAdd.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'));

    const result = await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result.status).toBe('unreachable');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns error when OpenCode responds with error', async () => {
    mockMcpAdd.mockResolvedValueOnce({
      error: { message: 'Internal Server Error (500)' },
    });

    const result = await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  it('uses configurable MCP server name', async () => {
    mockMcpAdd.mockResolvedValueOnce({ data: { status: 'ready' } });

    await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
      mcpName: 'my-custom-mcp',
    });

    const call = mockMcpAdd.mock.calls[0][0];
    expect(call.body.name).toBe('my-custom-mcp');
  });

  it('registerMcpAcrossReachablePorts delegates to registerMcpWithOpenCode', async () => {
    mockMcpAdd.mockResolvedValueOnce({ data: { status: 'ready' } });

    const result = await registerMcpAcrossReachablePorts({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result).toEqual({ status: 'registered' });
    expect(mockMcpAdd).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  registerMcpWithRetry                                              */
/* ------------------------------------------------------------------ */
describe('registerMcpWithRetry', () => {
  const baseOptions = { appPort: 3100, openCodePort: 4096 };
  let mockRegister: Mock<
    (opts: {
      appPort: number;
      openCodePort: number;
    }) => Promise<McpRegistrationResult>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRegister = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately on first success without retrying', async () => {
    mockRegister.mockResolvedValue({ status: 'registered' });

    const result = await registerMcpWithRetry(
      { ...baseOptions, maxRetries: 3, initialDelayMs: 1000 },
      mockRegister,
    );

    expect(result.status).toBe('registered');
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('retries on unreachable and succeeds on second attempt', async () => {
    mockRegister
      .mockResolvedValueOnce({ status: 'unreachable', error: 'ECONNREFUSED' })
      .mockResolvedValueOnce({ status: 'registered' });

    const promise = registerMcpWithRetry(
      { ...baseOptions, maxRetries: 3, initialDelayMs: 1000 },
      mockRegister,
    );

    // First call already happened (unreachable), now advance past the delay
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.status).toBe('registered');
    expect(mockRegister).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on error status', async () => {
    mockRegister.mockResolvedValue({
      status: 'error',
      error: 'OpenCode returned 500 Internal Server Error',
    });

    const result = await registerMcpWithRetry(
      { ...baseOptions, maxRetries: 3, initialDelayMs: 1000 },
      mockRegister,
    );

    expect(result.status).toBe('error');
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('respects maxRetries limit', async () => {
    mockRegister.mockResolvedValue({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });

    const maxRetries = 3;
    const promise = registerMcpWithRetry(
      { ...baseOptions, maxRetries, initialDelayMs: 1000 },
      mockRegister,
    );

    // Advance through all retry delays: 1000, 2000, 4000
    for (let i = 0; i < maxRetries; i++) {
      await vi.advanceTimersByTimeAsync(60_000); // large enough to cover any delay
    }

    const result = await promise;

    expect(result.status).toBe('unreachable');
    // 1 initial + maxRetries retries
    expect(mockRegister).toHaveBeenCalledTimes(1 + maxRetries);
  });

  it('respects AbortSignal cancellation', async () => {
    mockRegister.mockResolvedValue({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });

    const ac = new AbortController();
    const promise = registerMcpWithRetry(
      {
        ...baseOptions,
        maxRetries: 5,
        initialDelayMs: 1000,
        signal: ac.signal,
      },
      mockRegister,
    );

    // Abort before the first retry delay elapses
    ac.abort();
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.status).toBe('unreachable');
    // Only the initial call — no retries should have been attempted
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('caps exponential backoff at maxDelayMs', async () => {
    const delays: number[] = [];
    const consoleSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((msg: string) => {
        const match = msg.match(/in (\d+)ms/);
        if (match) delays.push(Number(match[1]));
      });

    mockRegister.mockResolvedValue({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });

    const promise = registerMcpWithRetry(
      {
        ...baseOptions,
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
      },
      mockRegister,
    );

    // Advance enough time for all retries
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    await promise;

    // Expected delays: 1000, 2000, 4000, 5000(capped), 5000(capped)
    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000]);
    consoleSpy.mockRestore();
  });
});
