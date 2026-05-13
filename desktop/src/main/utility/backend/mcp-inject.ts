/**
 * Auto-injects project-specific MCP servers when a session registers with a baseDirectory.
 *
 * This module calls OpenCode's SDK config endpoint to retrieve the merged project
 * MCP definitions, then calls OpenCode's SDK to register each project-specific
 * MCP server dynamically.
 *
 * This implements Option B from the MCP-DETECTION.md proposal: automatic MCP injection
 * based on the baseDirectory provided during `register_connection`.
 */

import {
  type McpLocalConfig,
  type McpRemoteConfig,
} from '@opencode-ai/sdk/v2/client';
import { createLogger, type Logger } from '../../utils/logger';
import { errorMessage } from '../../utils/errors';
import { withTimeout } from '../../utils/with-timeout';
import { getClient } from './sdk-client';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * MCP server configuration from opencode.jsonc.
 * Mirrors OpenCode's MCP config schema.
 */
export interface McpServerConfig {
  type: 'local' | 'remote';
  /** Command for local MCPs (e.g., ["npx", "-y", "@azure-devops/mcp"]) */
  command?: string[];
  /** Arguments passed to the command (optional, for local MCPs) */
  args?: string[];
  /** URL for remote MCPs (e.g., "http://127.0.0.1:3845/mcp") */
  url?: string;
  /** Environment variables for local MCPs */
  environment?: Record<string, string>;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
  /** Whether the MCP is enabled (defaults to true) */
  enabled?: boolean;
}

/**
 * Result of injecting a single MCP server.
 */
export interface McpInjectionResult {
  name: string;
  status: 'injected' | 'skipped' | 'error';
  error?: string;
}

/**
 * Result of the full MCP injection process.
 */
export interface McpInjectionSummary {
  /** Whether the config was found and parsed */
  configFound: boolean;
  /** Parse error if config exists but couldn't be parsed */
  parseError?: string;
  /** Results for each MCP server */
  results: McpInjectionResult[];
  /** Names of successfully injected MCPs (for tracking/cleanup) */
  injectedMcps: string[];
}

/**
 * Options for the injection process.
 */
export interface McpInjectionOptions {
  /** Base directory containing the .opencode/opencode.jsonc config */
  baseDirectory: string;
  /** Port the OpenCode HTTP API is listening on */
  openCodePort: number;
  /** Timeout for each MCP registration HTTP call (default 5000ms) */
  timeoutMs?: number;
  /** Optional logger for debugging (defaults to createLogger('mcp-inject')) */
  logger?: Logger;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;
const MCP_REGISTRATION_TIMEOUT_MS = 30_000;
const MCP_INJECTION_CONCURRENCY = 10;

// ─── MCP Injection ────────────────────────────────────────────────────────────

/**
 * Register a single MCP server with OpenCode via SDK.
 */
async function registerSingleMcp(
  name: string,
  config: McpLocalConfig | McpRemoteConfig,
  openCodePort: number,
  baseDirectory: string,
  timeoutMs: number,
  logger: Logger,
): Promise<McpInjectionResult> {
  // Skip disabled MCPs
  if (config.enabled === false) {
    logger.info(`Skipping disabled MCP: ${name}`);
    return { name, status: 'skipped', error: 'disabled' };
  }

  logger.info(`Registering MCP: ${name} (type: ${config.type})`);

  try {
    const client = getClient(openCodePort, baseDirectory);
    const response = await client.mcp.add(
      {
        name,
        config,
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );

    if (response.error) {
      const error = `OpenCode returned error: ${JSON.stringify(response.error)}`;
      logger.warn(`Failed to register MCP ${name}: ${error}`);
      return { name, status: 'error', error };
    }

    logger.info(`Successfully registered MCP: ${name}`);
    return { name, status: 'injected' };
  } catch (err) {
    const error = errorMessage(err);
    logger.error(`Failed to register MCP ${name}: ${error}`);
    return { name, status: 'error', error };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let index = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Inject project-specific MCPs by fetching the merged config from the running
 * OpenCode server via `client.config.get({ directory })`.
 *
 * This function:
 * 1. Calls `GET /config?directory=<baseDirectory>` via the SDK
 * 2. Extracts the `mcp` object containing MCP server definitions
 * 3. Calls `POST /mcp` for each MCP server to register it with OpenCode
 * 4. Returns a summary of the injection results
 *
 * @param options - Injection options including baseDirectory and openCodePort
 * @returns Summary of the injection process
 */
export async function injectProjectMcps(
  options: McpInjectionOptions,
): Promise<McpInjectionSummary> {
  const {
    baseDirectory,
    openCodePort,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger = createLogger('mcp-inject'),
  } = options;

  logger.info(`Fetching project MCP config for: ${baseDirectory}`);

  // Fetch merged config from the running OpenCode server
  let mcpConfig:
    | Record<string, McpLocalConfig | McpRemoteConfig | { enabled: boolean }>
    | undefined;
  try {
    const client = getClient(openCodePort, baseDirectory);
    const response = await client.config.get(
      { directory: baseDirectory },
      { signal: AbortSignal.timeout(timeoutMs) },
    );

    if (response.error) {
      const msg = `Config fetch error: ${JSON.stringify(response.error)}`;
      logger.error(msg);
      return {
        configFound: false,
        parseError: msg,
        results: [],
        injectedMcps: [],
      };
    }

    mcpConfig = response.data?.mcp;
  } catch (err) {
    const msg = errorMessage(err);
    logger.error(`Failed to fetch config: ${msg}`);
    return {
      configFound: false,
      parseError: `fetch-error: ${msg}`,
      results: [],
      injectedMcps: [],
    };
  }

  if (!mcpConfig || typeof mcpConfig !== 'object') {
    logger.info(`No MCP section found in config for ${baseDirectory}`);
    return {
      configFound: true,
      results: [],
      injectedMcps: [],
    };
  }

  // Filter out entries that are only { enabled: boolean } (no type field)
  const mcpEntries = Object.entries(mcpConfig).filter(
    (entry): entry is [string, McpLocalConfig | McpRemoteConfig] => {
      const cfg = entry[1];
      return 'type' in cfg;
    },
  );

  if (mcpEntries.length === 0) {
    logger.info(
      `MCP section is empty or has no typed entries for ${baseDirectory}`,
    );
    return {
      configFound: true,
      results: [],
      injectedMcps: [],
    };
  }

  logger.info(
    `Found ${mcpEntries.length} MCP(s) to inject for ${baseDirectory}`,
  );

  // Phase 2: pre-filter entries that are already connected/connecting to OpenCode
  // (e.g. globals OpenCode loaded natively at spawn) to avoid redundant mcp.add() calls.
  let entriesToRegister = mcpEntries;
  try {
    const client = getClient(openCodePort, baseDirectory);
    const statusResponse = await client.mcp.status(
      {},
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!statusResponse.error && statusResponse.data) {
      const alreadyActive = new Set(
        Object.entries(statusResponse.data)
          .filter(([, s]) => {
            const status = (s as { status?: string } | undefined)?.status;
            return status === 'connected' || status === 'connecting';
          })
          .map(([name]) => name),
      );
      if (alreadyActive.size > 0) {
        const skipped = mcpEntries.filter(([name]) => alreadyActive.has(name));
        entriesToRegister = mcpEntries.filter(
          ([name]) => !alreadyActive.has(name),
        );
        logger.info(
          `Skipping ${skipped.length} already-active MCP(s): ${skipped.map(([n]) => n).join(', ')}`,
        );
      }
    }
  } catch (err) {
    logger.warn(
      `Pre-filter mcp.status check failed (registering all entries): ${errorMessage(err)}`,
    );
  }

  if (entriesToRegister.length === 0) {
    return {
      configFound: true,
      results: mcpEntries.map(([name]) => ({
        name,
        status: 'skipped' as const,
        error: 'already-active',
      })),
      injectedMcps: [],
    };
  }

  const results = await mapWithConcurrency(
    entriesToRegister,
    MCP_INJECTION_CONCURRENCY,
    async ([name, mcpServerConfig]) =>
      withTimeout(
        registerSingleMcp(
          name,
          mcpServerConfig,
          openCodePort,
          baseDirectory,
          timeoutMs,
          logger,
        ),
        MCP_REGISTRATION_TIMEOUT_MS,
        `MCP registration timed out: ${name}`,
      ).catch((err) => ({
        name,
        status: 'error' as const,
        error: errorMessage(err),
      })),
  );

  const injectedMcps = results
    .filter((result) => result.status === 'injected')
    .map((result) => result.name);

  logger.info(
    `MCP injection complete: ${injectedMcps.length}/${mcpEntries.length} injected`,
  );

  return {
    configFound: true,
    results,
    injectedMcps,
  };
}

// ─── In-Memory Tracking ───────────────────────────────────────────────────────

/**
 * In-memory store for tracking which MCPs were auto-injected per session.
 * Key: providerSessionId (OpenCode session ID or connectionId)
 * Value: Array of injected MCP names
 *
 * This is used for potential cleanup when a session ends or when the user
 * wants to see which MCPs were auto-injected for a specific session.
 */
const injectedMcpsBySession = new Map<string, string[]>();

/**
 * Record which MCPs were injected for a session.
 * Called after successful MCP injection.
 */
export function recordInjectedMcps(
  sessionId: string,
  mcpNames: string[],
): void {
  if (mcpNames.length === 0) return;

  const existing = injectedMcpsBySession.get(sessionId) ?? [];
  const merged = [...new Set([...existing, ...mcpNames])];
  injectedMcpsBySession.set(sessionId, merged);
}

/**
 * Get the list of MCPs that were auto-injected for a session.
 */
export function getInjectedMcps(sessionId: string): string[] {
  return injectedMcpsBySession.get(sessionId) ?? [];
}

/**
 * Clear the injected MCPs record for a session.
 * Called when a session is cleaned up.
 */
export function clearInjectedMcps(sessionId: string): void {
  injectedMcpsBySession.delete(sessionId);
}

/**
 * Get all sessions that have injected MCPs.
 * Useful for debugging and UI display.
 */
export function getAllInjectedMcpSessions(): Map<string, string[]> {
  return new Map(injectedMcpsBySession);
}

/**
 * Reset all tracking state.
 * **Test-only** — allows tests to start from a clean slate.
 */
export function _resetTrackingForTest(): void {
  injectedMcpsBySession.clear();
}
