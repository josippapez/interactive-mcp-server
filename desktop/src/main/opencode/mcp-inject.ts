/**
 * Auto-injects project-specific MCP servers when a session registers with a baseDirectory.
 *
 * This module reads the `.opencode/opencode.jsonc` config from a project directory,
 * parses the MCP definitions, and calls OpenCode's SDK to register each
 * project-specific MCP server dynamically.
 *
 * This implements Option B from the MCP-DETECTION.md proposal: automatic MCP injection
 * based on the baseDirectory provided during `register_connection`.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger, type Logger } from '../utils/logger';
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
  /** Whether the config file was found and parsed */
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

const CONFIG_PATH = '.opencode/opencode.jsonc';
const DEFAULT_TIMEOUT_MS = 5000;
const MCP_INJECTION_CONCURRENCY = 3;

// ─── JSONC Parser ─────────────────────────────────────────────────────────────

/**
 * Strip single-line `// ...` and block `/* ... * /` comments from JSONC.
 * Handles comments outside of strings only.
 */
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    if (!inString) {
      // Single-line comment
      if (ch === '/' && next === '/') {
        // Skip to end of line
        while (i < text.length && text[i] !== '\n') {
          i++;
        }
        continue;
      }

      // Block comment
      if (ch === '/' && next === '*') {
        i += 2;
        // Skip to end of block comment
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
          i++;
        }
        i += 2; // Skip closing */
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Parse a JSONC file (JSON with comments).
 * Returns null if the file doesn't exist or can't be parsed.
 */
function parseJsonc<T>(
  filePath: string,
  logger: Logger,
): { data: T; error?: undefined } | { data?: undefined; error: string } {
  if (!existsSync(filePath)) {
    return { error: 'file-not-found' };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to read ${filePath}: ${msg}`);
    return { error: `read-error: ${msg}` };
  }

  const stripped = stripJsonComments(raw);

  try {
    const data = JSON.parse(stripped) as T;
    return { data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to parse ${filePath}: ${msg}`);
    return { error: `parse-error: ${msg}` };
  }
}

// ─── MCP Injection ────────────────────────────────────────────────────────────

/**
 * Register a single MCP server with OpenCode via SDK.
 */
async function registerSingleMcp(
  name: string,
  config: McpServerConfig,
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

  // Build the config payload matching OpenCode's expected format.
  // Use a discriminated union so the SDK types narrow correctly.
  const mcpConfig =
    config.type === 'remote'
      ? {
          type: 'remote' as const,
          url: config.url ?? '',
          ...(config.args ? { args: config.args } : {}),
          ...(config.environment ? { environment: config.environment } : {}),
          ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
        }
      : {
          type: 'local' as const,
          command: config.command ?? [],
          ...(config.args ? { args: config.args } : {}),
          ...(config.environment ? { environment: config.environment } : {}),
          ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
        };

  logger.info(`Registering MCP: ${name} (type: ${config.type})`);

  try {
    const client = getClient(openCodePort, baseDirectory);
    const response = await client.mcp.add(
      {
        name,
        config: mcpConfig,
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
    const error = err instanceof Error ? err.message : String(err);
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
 * Inject project-specific MCPs from a baseDirectory's `.opencode/opencode.jsonc`.
 *
 * This function:
 * 1. Reads the config file from `<baseDirectory>/.opencode/opencode.jsonc`
 * 2. Parses the JSONC content (supports // and /* comments)
 * 3. Extracts the `mcp` object containing MCP server definitions
 * 4. Calls `POST /mcp` for each MCP server to register it with OpenCode
 * 5. Returns a summary of the injection results
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

  const configPath = join(baseDirectory, CONFIG_PATH);

  logger.info(`Checking for project MCPs in: ${configPath}`);

  // Parse the config file
  const parseResult = parseJsonc<{
    mcp?: Record<string, McpServerConfig>;
  }>(configPath, logger);

  if (parseResult.error) {
    if (parseResult.error === 'file-not-found') {
      logger.info(`No config found at ${configPath}`);
      return {
        configFound: false,
        results: [],
        injectedMcps: [],
      };
    }

    return {
      configFound: true,
      parseError: parseResult.error,
      results: [],
      injectedMcps: [],
    };
  }

  const config = parseResult.data;
  const mcpConfig = config?.mcp;

  if (!mcpConfig || typeof mcpConfig !== 'object') {
    logger.info(`No MCP section found in ${configPath}`);
    return {
      configFound: true,
      results: [],
      injectedMcps: [],
    };
  }

  const mcpEntries = Object.entries(mcpConfig);

  if (mcpEntries.length === 0) {
    logger.info(`MCP section is empty in ${configPath}`);
    return {
      configFound: true,
      results: [],
      injectedMcps: [],
    };
  }

  logger.info(`Found ${mcpEntries.length} MCP(s) to inject from ${configPath}`);

  const results = await mapWithConcurrency(
    mcpEntries,
    MCP_INJECTION_CONCURRENCY,
    async ([name, mcpServerConfig]) =>
      registerSingleMcp(
        name,
        mcpServerConfig,
        openCodePort,
        baseDirectory,
        timeoutMs,
        logger,
      ),
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
