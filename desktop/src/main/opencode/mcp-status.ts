/**
 * MCP server status and operations via OpenCode SDK.
 *
 * Uses the SDK client to retrieve the status of all MCP servers,
 * and provides operations to connect/disconnect individual servers.
 */

import type {
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
} from '@opencode-ai/sdk';
import { createLogger } from '../utils/logger';
import { getClient } from './sdk-client';

const log = createLogger('mcp-status');

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * MCP server status normalized for internal use.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map SDK McpStatus to our internal status string.
 */
function mapSdkStatus(
  sdkStatus: McpStatus,
): McpServerStatus['status'] | 'disabled' | 'needs_auth' {
  switch (sdkStatus.status) {
    case 'connected':
      return 'connected';
    case 'disabled':
      return 'disconnected';
    case 'failed':
      return 'error';
    case 'needs_auth':
      return 'needs_auth';
    case 'needs_client_registration':
      return 'error';
    default:
      return 'disconnected';
  }
}

/**
 * Extract error message from SDK McpStatus if present.
 */
function extractError(sdkStatus: McpStatus): string | undefined {
  if (sdkStatus.status === 'failed') {
    return sdkStatus.error;
  }
  if (sdkStatus.status === 'needs_client_registration') {
    return sdkStatus.error;
  }
  return undefined;
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetch the status of all MCP servers from OpenCode.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param directory - Optional directory context for the request
 */
export async function fetchMcpStatus(
  openCodePort: number,
  directory?: string,
): Promise<McpStatusResult> {
  log.info(`Fetching MCP status from port ${openCodePort}`);

  try {
    const client = getClient(openCodePort);
    const response = await client.mcp.status({
      query: directory ? { directory } : undefined,
    });

    if (response.error) {
      const error =
        typeof response.error === 'string'
          ? response.error
          : 'Failed to fetch MCP status';
      log.error(`Failed to fetch MCP status: ${error}`);
      return { ok: false, error };
    }

    const data = response.data ?? {};

    // Transform SDK response to our internal format
    const servers: McpServerStatus[] = Object.entries(data).map(
      ([name, serverStatus]) => {
        const status = mapSdkStatus(serverStatus);
        return {
          name,
          // SDK doesn't expose type directly in status, default to 'local'
          type: 'local' as const,
          status:
            status === 'disabled' || status === 'needs_auth'
              ? 'disconnected'
              : status,
          error: extractError(serverStatus),
          // These fields aren't in SDK status response, leave undefined
          url: undefined,
          command: undefined,
          environmentKeys: undefined,
          tools: undefined,
          resources: undefined,
          prompts: undefined,
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
 */
export async function connectMcp(
  openCodePort: number,
  mcpName: string,
  directory?: string,
): Promise<McpOperationResult> {
  log.info(`Connecting MCP: ${mcpName}`);

  try {
    const client = getClient(openCodePort);
    const response = await client.mcp.connect({
      path: { name: mcpName },
      query: directory ? { directory } : undefined,
    });

    if (response.error) {
      const error =
        typeof response.error === 'string'
          ? response.error
          : `Failed to connect MCP: ${mcpName}`;
      log.error(`Failed to connect MCP ${mcpName}: ${error}`);
      return { ok: false, error };
    }

    log.info(`Successfully connected MCP: ${mcpName}`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Failed to connect MCP ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Disconnect an MCP server.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param mcpName - The name of the MCP server to disconnect
 * @param directory - Optional directory context for the request
 */
export async function disconnectMcp(
  openCodePort: number,
  mcpName: string,
  directory?: string,
): Promise<McpOperationResult> {
  log.info(`Disconnecting MCP: ${mcpName}`);

  try {
    const client = getClient(openCodePort);
    const response = await client.mcp.disconnect({
      path: { name: mcpName },
      query: directory ? { directory } : undefined,
    });

    if (response.error) {
      const error =
        typeof response.error === 'string'
          ? response.error
          : `Failed to disconnect MCP: ${mcpName}`;
      log.error(`Failed to disconnect MCP ${mcpName}: ${error}`);
      return { ok: false, error };
    }

    log.info(`Successfully disconnected MCP: ${mcpName}`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Failed to disconnect MCP ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Register a new MCP server with OpenCode.
 *
 * @param openCodePort - The port OpenCode's HTTP API is listening on
 * @param name - The name for the MCP server
 * @param config - The MCP server configuration
 * @param directory - Optional directory context for the request
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
): Promise<McpOperationResult> {
  log.info(`Registering MCP: ${name} (type: ${config.type})`);

  try {
    const client = getClient(openCodePort);

    // Build SDK-compatible config
    const sdkConfig: McpLocalConfig | McpRemoteConfig =
      config.type === 'local'
        ? {
            type: 'local',
            command: config.command ?? [],
            environment: config.environment,
            timeout: config.timeout,
          }
        : {
            type: 'remote',
            url: config.url ?? '',
            timeout: config.timeout,
          };

    const response = await client.mcp.add({
      body: { name, config: sdkConfig },
      query: directory ? { directory } : undefined,
    });

    if (response.error) {
      const error =
        typeof response.error === 'string'
          ? response.error
          : `Failed to register MCP: ${name}`;
      log.error(`Failed to register MCP ${name}: ${error}`);
      return { ok: false, error };
    }

    log.info(`Successfully registered MCP: ${name}`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Failed to register MCP ${name}: ${error}`);
    return { ok: false, error };
  }
}
