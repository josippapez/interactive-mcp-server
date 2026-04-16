/**
 * Dynamically registers the Interactive MCP Desktop as an MCP server
 * with a running OpenCode instance via SDK `client.mcp.add()`.
 *
 * This is the primary connection method — it tells OpenCode "I'm an MCP
 * server at this URL, connect to me" without requiring any config file edits.
 */

import { getClient } from './sdk-client';

/** Default name for the MCP server entry in OpenCode. */
const DEFAULT_MCP_NAME = 'interactive-desktop';

/** Request timeout for MCP registration calls to OpenCode. */
const MCP_REGISTER_REQUEST_TIMEOUT_MS = 10_000;

/** Extra timeout buffer to outlast the user prompt window. */
const MCP_TIMEOUT_BUFFER_MS = 60_000;

export interface McpRegistrationOptions {
  appPort: number;
  openCodePort: number;
  timeoutMs?: number;
  mcpName?: string;
  promptTimeoutSeconds?: number;
}

function computeRemoteMcpTimeout(promptTimeoutSeconds = 1200): number {
  return promptTimeoutSeconds * 1000 + MCP_TIMEOUT_BUFFER_MS;
}

export interface McpRegistrationResult {
  status: 'registered' | 'unreachable' | 'error';
  error?: string;
}

export interface McpRetryOptions extends McpRegistrationOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Wraps `registerMcpWithOpenCode()` with exponential backoff retries.
 */
export async function registerMcpWithRetry(
  options: McpRetryOptions,
  _register: (
    opts: McpRegistrationOptions,
  ) => Promise<McpRegistrationResult> = registerMcpWithOpenCode,
): Promise<McpRegistrationResult> {
  const {
    maxRetries = 5,
    initialDelayMs = 2000,
    maxDelayMs = 30_000,
    signal,
    ...registrationOptions
  } = options;

  let lastResult = await _register(registrationOptions);

  if (lastResult.status !== 'unreachable') {
    return lastResult;
  }

  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      return lastResult;
    }

    console.log(
      `[mcp-register] retry ${attempt}/${maxRetries} in ${delay}ms...`,
    );

    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    if (signal?.aborted) {
      return lastResult;
    }

    lastResult = await _register(registrationOptions);

    if (lastResult.status !== 'unreachable') {
      return lastResult;
    }

    delay = Math.min(delay * 2, maxDelayMs);
  }

  return lastResult;
}

/**
 * Register the desktop app as a remote MCP server with OpenCode.
 */
export async function registerMcpWithOpenCode(
  options: McpRegistrationOptions,
): Promise<McpRegistrationResult> {
  const {
    appPort,
    openCodePort,
    mcpName = DEFAULT_MCP_NAME,
    promptTimeoutSeconds,
  } = options;

  try {
    const client = getClient(openCodePort);
    const response = await client.mcp.add(
      {
        name: mcpName,
        config: {
          type: 'remote',
          url: `http://localhost:${appPort}/mcp`,
          timeout: computeRemoteMcpTimeout(promptTimeoutSeconds),
        },
      },
      { signal: AbortSignal.timeout(MCP_REGISTER_REQUEST_TIMEOUT_MS) },
    );

    if (response.error) {
      const errorValue = response.error as unknown;
      const errorMessage =
        typeof errorValue === 'string'
          ? errorValue
          : errorValue &&
              typeof errorValue === 'object' &&
              'message' in errorValue
            ? String((errorValue as { message: unknown }).message)
            : `OpenCode returned error`;
      return {
        status: 'error',
        error: errorMessage,
      };
    }

    return { status: 'registered' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isConnectionError =
      message.includes('ECONNREFUSED') ||
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('timeout');
    return {
      status: isConnectionError ? 'unreachable' : 'error',
      error: message,
    };
  }
}

/**
 * Register the desktop MCP server with OpenCode.
 * Simplified to use single port (no multi-port probing).
 */
export async function registerMcpAcrossReachablePorts(
  options: McpRegistrationOptions,
): Promise<McpRegistrationResult> {
  return registerMcpWithOpenCode(options);
}
