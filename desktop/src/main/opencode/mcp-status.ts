/**
 * Fetches MCP server status from OpenCode's HTTP API.
 *
 * Uses GET /mcp to retrieve the status of all MCP servers,
 * and provides operations to connect/disconnect individual servers.
 */

import { createLogger } from '../utils/logger';
import {
  buildOpenCodePortCandidates,
  fetchFirstSuccessfulJson,
} from './endpoints';

const log = createLogger('mcp-status');

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * MCP server status as returned by OpenCode's GET /mcp endpoint.
 */
export interface McpServerStatus {
  /** Server name (key in the mcp config) */
  name: string;
  /** Server type: local (subprocess) or remote (HTTP) */
  type: 'local' | 'remote';
  /** Connection status */
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** Error message if status is 'error' */
  error?: string;
  /** URL for remote servers */
  url?: string;
  /** Command for local servers */
  command?: string[];
  /** Environment variables (keys only, values hidden) */
  environmentKeys?: string[];
  /** Available tools provided by this MCP */
  tools?: McpTool[];
  /** Available resources provided by this MCP */
  resources?: McpResource[];
  /** Available prompts provided by this MCP */
  prompts?: McpPrompt[];
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpResource {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
}

/**
 * Result of fetching MCP status.
 */
export interface McpStatusResult {
  ok: boolean;
  servers?: McpServerStatus[];
  error?: string;
}

/**
 * Result of an MCP operation (connect/disconnect).
 */
export interface McpOperationResult {
  ok: boolean;
  error?: string;
}

// ─── Default timeout ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetch the status of all MCP servers from OpenCode.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param directory - Optional directory context for the request
 * @param timeoutMs - Request timeout in milliseconds (default 5000)
 */
export async function fetchMcpStatus(
  openCodePort: number,
  directory?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpStatusResult> {
  const ports = buildOpenCodePortCandidates(openCodePort);
  const path = directory
    ? `/mcp?directory=${encodeURIComponent(directory)}`
    : '/mcp';

  log.info(
    `Fetching MCP status from candidates: ${ports.map((port) => `http://localhost:${port}${path}`).join(', ')}`,
  );

  try {
    const response = await fetchFirstSuccessfulJson<Record<string, unknown>>(
      ports,
      path,
      timeoutMs,
    );
    if (!response) {
      const error = 'No reachable OpenCode MCP endpoint';
      log.error(`Failed to fetch MCP status: ${error}`);
      return { ok: false, error };
    }
    const data = response.data;

    // OpenCode returns an object keyed by MCP name
    // Transform to array with name included
    const servers: McpServerStatus[] = Object.entries(data).map(
      ([name, serverData]) => {
        const server = serverData as Record<string, unknown>;
        return {
          name,
          type: (server.type as 'local' | 'remote') ?? 'local',
          status:
            (server.status as McpServerStatus['status']) ?? 'disconnected',
          error: server.error as string | undefined,
          url: server.url as string | undefined,
          command: server.command as string[] | undefined,
          environmentKeys: server.environment
            ? Object.keys(server.environment as Record<string, string>)
            : undefined,
          tools: server.tools as McpTool[] | undefined,
          resources: server.resources as McpResource[] | undefined,
          prompts: server.prompts as McpPrompt[] | undefined,
        };
      },
    );

    log.info(`Fetched ${servers.length} MCP servers`);
    return { ok: true, servers };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Failed to fetch MCP status: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Connect or reconnect an MCP server.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param mcpName - The name of the MCP server to connect
 * @param directory - Optional directory context for the request
 * @param timeoutMs - Request timeout in milliseconds (default 5000)
 */
export async function connectMcp(
  openCodePort: number,
  mcpName: string,
  directory?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpOperationResult> {
  const ports = buildOpenCodePortCandidates(openCodePort);
  const path = directory
    ? `/mcp/${encodeURIComponent(mcpName)}/connect?directory=${encodeURIComponent(directory)}`
    : `/mcp/${encodeURIComponent(mcpName)}/connect`;

  log.info(`Connecting MCP: ${mcpName}`);

  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        continue;
      }

      log.info(`Successfully connected MCP: ${mcpName} on port ${port}`);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`Failed to connect MCP ${mcpName} on port ${port}: ${error}`);
    }
  }

  return { ok: false, error: 'No reachable OpenCode MCP endpoint' };
}

/**
 * Disconnect an MCP server.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param mcpName - The name of the MCP server to disconnect
 * @param directory - Optional directory context for the request
 * @param timeoutMs - Request timeout in milliseconds (default 5000)
 */
export async function disconnectMcp(
  openCodePort: number,
  mcpName: string,
  directory?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpOperationResult> {
  const ports = buildOpenCodePortCandidates(openCodePort);
  const path = directory
    ? `/mcp/${encodeURIComponent(mcpName)}/disconnect?directory=${encodeURIComponent(directory)}`
    : `/mcp/${encodeURIComponent(mcpName)}/disconnect`;

  log.info(`Disconnecting MCP: ${mcpName}`);

  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        continue;
      }

      log.info(`Successfully disconnected MCP: ${mcpName} on port ${port}`);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(
        `Failed to disconnect MCP ${mcpName} on port ${port}: ${error}`,
      );
    }
  }

  return { ok: false, error: 'No reachable OpenCode MCP endpoint' };
}

/**
 * Register a new MCP server with OpenCode.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param name - The name for the MCP server
 * @param config - The MCP server configuration
 * @param directory - Optional directory context for the request
 * @param timeoutMs - Request timeout in milliseconds (default 5000)
 */
export async function registerMcp(
  openCodePort: number,
  name: string,
  config: {
    type: 'local' | 'remote';
    url?: string;
    command?: string[];
    environment?: Record<string, string>;
    timeout?: number;
  },
  directory?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpOperationResult> {
  const ports = buildOpenCodePortCandidates(openCodePort);
  const path = directory
    ? `/mcp?directory=${encodeURIComponent(directory)}`
    : '/mcp';

  log.info(`Registering MCP: ${name} (type: ${config.type})`);

  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        continue;
      }

      log.info(`Successfully registered MCP: ${name} on port ${port}`);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`Failed to register MCP ${name} on port ${port}: ${error}`);
    }
  }

  return { ok: false, error: 'No reachable OpenCode MCP endpoint' };
}
