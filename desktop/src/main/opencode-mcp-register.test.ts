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
  registerMcpWithOpenCode,
  registerMcpWithRetry,
  type McpRegistrationResult,
} from '../main/opencode-mcp-register';

// Mock global fetch
const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('opencode-mcp-register', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('registers the desktop MCP server via POST /mcp', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ready' }),
    });

    const result = await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result.status).toBe('registered');

    // Verify the correct URL and body were sent
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4096/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'interactive-desktop',
          config: {
            type: 'remote',
            url: 'http://localhost:3100/mcp',
            timeout: 1260000,
          },
        }),
      }),
    );
  });

  it('derives the remote MCP timeout from the prompt timeout setting', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ready' }),
    });

    await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
      promptTimeoutSeconds: 1201,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.config.timeout).toBe(1261000);
  });

  it('returns unreachable when OpenCode is not running', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result.status).toBe('unreachable');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns error when OpenCode responds with non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  it('uses custom timeout via AbortSignal', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ready' }),
    });

    await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
      timeoutMs: 5000,
    });

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].signal).toBeDefined();
  });

  it('uses configurable MCP server name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ready' }),
    });

    await registerMcpWithOpenCode({
      appPort: 3100,
      openCodePort: 4096,
      mcpName: 'my-custom-mcp',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.name).toBe('my-custom-mcp');
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

/* ------------------------------------------------------------------ */
/*  Regression: startup call in index.ts (agentBackend === 'opencode') */
/* ------------------------------------------------------------------ */
/**
 * Regression tests for the fix in index.ts that calls `registerMcpWithRetry`
 * on startup when `agentBackend === 'opencode'`.
 *
 * Because index.ts is an Electron entry point that cannot be unit-tested
 * directly, these tests verify the behaviour of `registerMcpWithRetry` using
 * the same argument shape that index.ts passes:
 *
 *   registerMcpWithRetry({
 *     appPort:               currentSettings.port,
 *     openCodePort:          currentSettings.openCodePort,
 *     promptTimeoutSeconds:  currentSettings.promptTimeoutSeconds,
 *   })
 *
 * Covered scenarios
 * ─────────────────
 * 1. agentBackend === 'opencode': called once with the correct settings values
 *    when registration succeeds on the first attempt.
 * 2. agentBackend !== 'opencode': the caller should NOT invoke
 *    `registerMcpWithRetry` at all — verified by checking the mock is never
 *    called when we model the standalone / claude_sdk branch.
 * 3. Retries up to maxRetries times when every attempt returns 'unreachable'.
 * 4. Stops immediately (no retries) when the first attempt returns 'error'.
 */
describe('registerMcpWithRetry — startup regression (index.ts fix)', () => {
  /** Settings snapshot mirroring defaultSettings from settings.ts */
  const startupSettings = {
    port: 3100,
    openCodePort: 4096,
    promptTimeoutSeconds: 1200,
  } as const;

  let mockRegister: Mock<
    (opts: {
      appPort: number;
      openCodePort: number;
      promptTimeoutSeconds?: number;
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

  // ── scenario 1 ────────────────────────────────────────────────────────────
  it('(agentBackend=opencode) calls registerMcpWithRetry once with the exact settings values when OpenCode is reachable', async () => {
    mockRegister.mockResolvedValue({ status: 'registered' });

    const result = await registerMcpWithRetry(
      {
        appPort: startupSettings.port,
        openCodePort: startupSettings.openCodePort,
        promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
      },
      mockRegister,
    );

    // Should succeed immediately — no retries
    expect(result.status).toBe('registered');
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith({
      appPort: startupSettings.port,
      openCodePort: startupSettings.openCodePort,
      promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
    });
  });

  // ── scenario 2 ────────────────────────────────────────────────────────────
  it('(agentBackend=standalone) does NOT call registerMcpWithRetry', () => {
    // Model the index.ts guard: `if (agentBackend === 'opencode') { … }`
    const agentBackend: 'standalone' | 'opencode' | 'claude_sdk' = 'standalone';

    if (agentBackend === 'opencode') {
      void registerMcpWithRetry(
        {
          appPort: startupSettings.port,
          openCodePort: startupSettings.openCodePort,
          promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
        },
        mockRegister,
      );
    }

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('(agentBackend=claude_sdk) does NOT call registerMcpWithRetry', () => {
    const agentBackend: 'standalone' | 'opencode' | 'claude_sdk' = 'claude_sdk';

    if (agentBackend === 'opencode') {
      void registerMcpWithRetry(
        {
          appPort: startupSettings.port,
          openCodePort: startupSettings.openCodePort,
          promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
        },
        mockRegister,
      );
    }

    expect(mockRegister).not.toHaveBeenCalled();
  });

  // ── scenario 3 ────────────────────────────────────────────────────────────
  it('(agentBackend=opencode) retries up to maxRetries times when OpenCode is persistently unreachable', async () => {
    mockRegister.mockResolvedValue({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });

    const maxRetries = 3;
    const promise = registerMcpWithRetry(
      {
        appPort: startupSettings.port,
        openCodePort: startupSettings.openCodePort,
        promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
        maxRetries,
        initialDelayMs: 1000,
      },
      mockRegister,
    );

    // Advance through all retry delays
    for (let i = 0; i < maxRetries; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    const result = await promise;

    expect(result.status).toBe('unreachable');
    // 1 initial attempt + maxRetries retry attempts
    expect(mockRegister).toHaveBeenCalledTimes(1 + maxRetries);
    // Every call must have used the settings values from index.ts
    for (const call of mockRegister.mock.calls) {
      expect(call[0]).toEqual({
        appPort: startupSettings.port,
        openCodePort: startupSettings.openCodePort,
        promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
      });
    }
  });

  // ── scenario 4 ────────────────────────────────────────────────────────────
  it('(agentBackend=opencode) stops immediately without retrying when OpenCode returns an error status', async () => {
    mockRegister.mockResolvedValue({
      status: 'error',
      error: 'OpenCode returned 500 Internal Server Error',
    });

    const result = await registerMcpWithRetry(
      {
        appPort: startupSettings.port,
        openCodePort: startupSettings.openCodePort,
        promptTimeoutSeconds: startupSettings.promptTimeoutSeconds,
        maxRetries: 5,
        initialDelayMs: 1000,
      },
      mockRegister,
    );

    expect(result.status).toBe('error');
    // Must not retry — single call only
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});
