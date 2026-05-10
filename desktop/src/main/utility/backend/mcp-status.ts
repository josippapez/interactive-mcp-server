/**
 * MCP server status and operations via OpenCode SDK.
 *
 * Uses the SDK client to retrieve the status of all MCP servers,
 * and provides operations to connect/disconnect individual servers.
 */

import type {
  Config as OpenCodeConfig,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
} from '@opencode-ai/sdk/v2';
import { createLogger } from '../../utils/logger';
import { getClient } from './sdk-client';
import { errorMessage } from '../../utils/errors';

const log = createLogger('mcp-status');
const MCP_STATUS_REQUEST_TIMEOUT_MS = 10_000;
const MCP_OPERATION_TIMEOUT_MS = 10_000;

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
  status:
    | 'connected'
    | 'disconnected'
    | 'connecting'
    | 'error'
    | 'needs_auth'
    | 'needs_client_registration';
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

export interface McpAuthStartResult {
  ok: boolean;
  authorizationUrl?: string;
  error?: string;
}

export interface McpAuthStatusResult {
  ok: boolean;
  status?: McpServerStatus['status'];
  error?: string;
}

type NormalizedSdkMcpStatus =
  | McpStatus
  | {
      status:
        | 'connected'
        | 'connecting'
        | 'disconnected'
        | 'error'
        | 'needs_client_registration';
      error?: string;
    };

type ConfiguredMcp = McpLocalConfig | McpRemoteConfig;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map SDK McpStatus to our internal status string.
 */
function mapSdkStatus(
  sdkStatus: NormalizedSdkMcpStatus,
): McpServerStatus['status'] | 'disabled' {
  switch (sdkStatus.status) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'disconnected':
      return 'disconnected';
    case 'error':
      return 'error';
    case 'disabled':
      return 'disconnected';
    case 'failed':
      return 'error';
    case 'needs_auth':
      return 'needs_auth';
    case 'needs_client_registration':
      return 'needs_client_registration';
    default:
      return 'disconnected';
  }
}

/**
 * Extract error message from SDK McpStatus if present.
 */
function extractError(sdkStatus: NormalizedSdkMcpStatus): string | undefined {
  if (sdkStatus.status === 'error') {
    return sdkStatus.error;
  }
  if (sdkStatus.status === 'failed') {
    return sdkStatus.error;
  }
  if (sdkStatus.status === 'needs_client_registration') {
    return sdkStatus.error;
  }
  return undefined;
}

function getConfiguredMcp(
  config: OpenCodeConfig | undefined,
  name: string,
): ConfiguredMcp | undefined {
  const value = config?.mcp?.[name];
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return undefined;
  }
  return value;
}

function getServerType(
  config: ConfiguredMcp | undefined,
  status: McpServerStatus['status'],
): McpServerStatus['type'] {
  if (config?.type === 'remote' || config?.type === 'local') {
    return config.type;
  }
  if (status === 'needs_auth' || status === 'needs_client_registration') {
    return 'remote';
  }
  return 'local';
}

function getEnvironmentKeys(
  config: ConfiguredMcp | undefined,
): string[] | undefined {
  if (!config || config.type !== 'local' || !config.environment) {
    return undefined;
  }
  const keys = Object.keys(config.environment);
  return keys.length > 0 ? keys : undefined;
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
    const client = getClient(openCodePort, directory);
    const [statusResponse, configResponse] = await Promise.all([
      client.mcp.status(
        {},
        { signal: AbortSignal.timeout(MCP_STATUS_REQUEST_TIMEOUT_MS) },
      ),
      client.config?.get?.(
        {},
        { signal: AbortSignal.timeout(MCP_STATUS_REQUEST_TIMEOUT_MS) },
      ) ?? Promise.resolve({ data: undefined, error: undefined }),
    ]);

    if (statusResponse.error) {
      const error =
        typeof statusResponse.error === 'string'
          ? statusResponse.error
          : 'Failed to fetch MCP status';
      log.error(`Failed to fetch MCP status: ${error}`);
      return { ok: false, error };
    }

    if (configResponse.error) {
      log.warn(
        `Failed to fetch MCP config metadata: ${String(configResponse.error)}`,
      );
    }

    const data = statusResponse.data ?? {};
    const config = configResponse.error ? undefined : configResponse.data;

    // Transform SDK response to our internal format
    const servers: McpServerStatus[] = Object.entries(data).map(
      ([name, serverStatus]) => {
        const status = mapSdkStatus(serverStatus);
        const mcpConfig = getConfiguredMcp(config, name);
        return {
          name,
          type: getServerType(
            mcpConfig,
            status === 'disabled' ? 'disconnected' : status,
          ),
          status: status === 'disabled' ? 'disconnected' : status,
          error: extractError(serverStatus),
          url: mcpConfig?.type === 'remote' ? mcpConfig.url : undefined,
          command: mcpConfig?.type === 'local' ? mcpConfig.command : undefined,
          environmentKeys: getEnvironmentKeys(mcpConfig),
        };
      },
    );

    log.info(`Fetched ${servers.length} MCP servers`);
    return { ok: true, servers };
  } catch (err) {
    const error = errorMessage(err);
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
    const client = getClient(openCodePort, directory);
    const response = await client.mcp.connect(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

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
    const error = errorMessage(err);
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
    const client = getClient(openCodePort, directory);
    const response = await client.mcp.disconnect(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

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
    const error = errorMessage(err);
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
    const client = getClient(openCodePort, directory);

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

    const response = await client.mcp.add(
      { name, config: sdkConfig },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

    if (response.error) {
      const rawError: unknown = response.error;
      const error =
        typeof rawError === 'string'
          ? rawError
          : `Failed to register MCP: ${name}`;
      log.error(`Failed to register MCP ${name}: ${error}`);
      return { ok: false, error };
    }

    log.info(`Successfully registered MCP: ${name}`);
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    log.error(`Failed to register MCP ${name}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Start MCP OAuth flow and return the authorization URL.
 */
export async function startMcpAuth(
  openCodePort: number,
  mcpName: string,
  directory?: string,
): Promise<McpAuthStartResult> {
  log.info(`Starting MCP auth: ${mcpName}`);

  try {
    const client = getClient(openCodePort, directory);
    const response = await client.mcp.auth.start(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

    if (response.error) {
      const rawError: unknown = response.error;
      const error =
        typeof rawError === 'string'
          ? rawError
          : `Failed to start MCP auth: ${mcpName}`;
      log.error(`Failed to start MCP auth ${mcpName}: ${error}`);
      return { ok: false, error };
    }

    if (!response.data?.authorizationUrl) {
      const error = `Missing authorization URL for MCP auth: ${mcpName}`;
      log.error(error);
      return { ok: false, error };
    }

    return { ok: true, authorizationUrl: response.data.authorizationUrl };
  } catch (err) {
    const error = errorMessage(err);
    log.error(`Failed to start MCP auth ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Complete MCP OAuth callback with an authorization code.
 */
export async function callbackMcpAuth(
  openCodePort: number,
  mcpName: string,
  code: string,
  directory?: string,
): Promise<McpAuthStatusResult> {
  log.info(`Completing MCP auth callback: ${mcpName}`);

  try {
    const client = getClient(openCodePort, directory);
    const response = await client.mcp.auth.callback(
      { name: mcpName, code },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

    if (response.error) {
      const rawError: unknown = response.error;
      const error =
        typeof rawError === 'string'
          ? rawError
          : `Failed to complete MCP auth callback: ${mcpName}`;
      log.error(`Failed to complete MCP auth callback ${mcpName}: ${error}`);
      return { ok: false, error };
    }

    if (!response.data) {
      const error = `Missing status from MCP auth callback: ${mcpName}`;
      log.error(error);
      return { ok: false, error };
    }

    const mapped = mapSdkStatus(response.data);
    return {
      ok: true,
      status: mapped === 'disabled' ? 'disconnected' : mapped,
    };
  } catch (err) {
    const error = errorMessage(err);
    log.error(`Failed to complete MCP auth callback ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Let OpenCode run the full MCP OAuth flow, including browser open/callback.
 */
export async function authenticateMcp(
  openCodePort: number,
  mcpName: string,
  directory?: string,
): Promise<McpAuthStatusResult> {
  log.info(`Authenticating MCP: ${mcpName}`);

  try {
    const client = getClient(openCodePort, directory);
    const response = await client.mcp.auth.authenticate(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

    if (response.error) {
      const rawError: unknown = response.error;
      const error =
        typeof rawError === 'string'
          ? rawError
          : `Failed to authenticate MCP: ${mcpName}`;
      log.error(`Failed to authenticate MCP ${mcpName}: ${error}`);
      return { ok: false, error };
    }

    if (!response.data) {
      const error = `Missing status from MCP authenticate: ${mcpName}`;
      log.error(error);
      return { ok: false, error };
    }

    const mapped = mapSdkStatus(response.data);
    return {
      ok: true,
      status: mapped === 'disabled' ? 'disconnected' : mapped,
    };
  } catch (err) {
    const error = errorMessage(err);
    log.error(`Failed to authenticate MCP ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Remove stored MCP OAuth credentials.
 */
export async function removeMcpAuth(
  openCodePort: number,
  mcpName: string,
  directory?: string,
): Promise<McpOperationResult> {
  log.info(`Removing MCP auth: ${mcpName}`);

  try {
    const client = getClient(openCodePort, directory);
    const response = await client.mcp.auth.remove(
      { name: mcpName },
      { signal: AbortSignal.timeout(MCP_OPERATION_TIMEOUT_MS) },
    );

    if (response.error) {
      const rawError: unknown = response.error;
      const error =
        typeof rawError === 'string'
          ? rawError
          : `Failed to remove MCP auth: ${mcpName}`;
      log.error(`Failed to remove MCP auth ${mcpName}: ${error}`);
      return { ok: false, error };
    }

    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    log.error(`Failed to remove MCP auth ${mcpName}: ${error}`);
    return { ok: false, error };
  }
}
