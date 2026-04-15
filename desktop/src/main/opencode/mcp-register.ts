/**
 * Dynamically registers the Interactive MCP Desktop as an MCP server
 * with a running OpenCode instance via `POST /mcp`.
 *
 * This is the primary connection method — it tells OpenCode "I'm an MCP
 * server at this URL, connect to me" without requiring any config file edits.
 *
 * Falls back gracefully when OpenCode is not reachable.
 */

import {
  buildOpenCodePortCandidates,
  resolveReachableOpenCodePorts,
} from './endpoints';

/** Default name for the MCP server entry in OpenCode. */
const DEFAULT_MCP_NAME = 'interactive-desktop';

/** Extra timeout buffer to outlast the user prompt window. */
const MCP_TIMEOUT_BUFFER_MS = 60_000;

/** Default timeout for the registration HTTP call (ms). */
const DEFAULT_TIMEOUT_MS = 3000;

export interface McpRegistrationOptions {
  /** Port the desktop app's MCP HTTP server is listening on. */
  appPort: number;
  /** Port the OpenCode HTTP API is listening on (default 4096). */
  openCodePort: number;
  /** Timeout for the HTTP call in ms (default 3000). */
  timeoutMs?: number;
  /** Name for the MCP server entry in OpenCode (default "interactive-desktop"). */
  mcpName?: string;
  /** Prompt timeout in seconds used to derive the MCP transport timeout. */
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
  /** Max number of retry attempts (default 5). */
  maxRetries?: number;
  /** Initial delay between retries in ms (default 2000). */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms (default 30000). */
  maxDelayMs?: number;
  /** Optional AbortSignal to cancel the retry loop. */
  signal?: AbortSignal;
}

/**
 * Wraps `registerMcpWithOpenCode()` with exponential backoff retries.
 *
 * - Returns immediately on `'registered'` or `'error'` (non-connection errors).
 * - Retries with exponential backoff on `'unreachable'`.
 * - Stops when `maxRetries` is exhausted or `signal` is aborted.
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
 *
 * Calls `POST http://localhost:{openCodePort}/mcp` with:
 * ```json
 * {
 *   "name": "interactive-desktop",
 *   "config": { "type": "remote", "url": "http://localhost:{appPort}/mcp" }
 * }
 * ```
 */
export async function registerMcpWithOpenCode(
  options: McpRegistrationOptions,
): Promise<McpRegistrationResult> {
  const {
    appPort,
    openCodePort,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    mcpName = DEFAULT_MCP_NAME,
    promptTimeoutSeconds,
  } = options;

  const url = `http://localhost:${openCodePort}/mcp`;
  const body = JSON.stringify({
    name: mcpName,
    config: {
      type: 'remote',
      url: `http://localhost:${appPort}/mcp`,
      timeout: computeRemoteMcpTimeout(promptTimeoutSeconds),
    },
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        status: 'error',
        error: `OpenCode returned ${res.status} ${res.statusText}`,
      };
    }

    return { status: 'registered' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'unreachable', error: message };
  }
}

/**
 * Register the desktop MCP server on every reachable OpenCode port.
 *
 * This keeps the registration flow aligned with the rest of the app's
 * multi-port probing behavior.
 */
export async function registerMcpAcrossReachablePorts(
  options: McpRegistrationOptions,
): Promise<McpRegistrationResult> {
  const { openCodePort, ...rest } = options;

  const reachablePorts = await resolveReachableOpenCodePorts(openCodePort);
  const candidatePorts =
    reachablePorts.length > 0
      ? reachablePorts
      : buildOpenCodePortCandidates(openCodePort);

  let sawRegistered = false;
  let sawError = false;
  let lastError: string | undefined;

  for (const port of candidatePorts) {
    const result = await registerMcpWithOpenCode({
      ...rest,
      openCodePort: port,
    });

    if (result.status === 'registered') {
      sawRegistered = true;
      continue;
    }

    if (result.status === 'error') {
      sawError = true;
      lastError = result.error;
      continue;
    }

    if (!sawError) {
      lastError = result.error;
    }
  }

  if (sawRegistered) {
    return { status: 'registered' };
  }

  if (sawError) {
    return { status: 'error', error: lastError };
  }

  return { status: 'unreachable', error: lastError };
}
