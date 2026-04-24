import type { ProviderType } from '../tools/register-connection';
import type { AgentBackend } from '../../../settings-core';

/**
 * Parse a provider string into a ProviderType.
 * Handles various aliases and normalizes to canonical values.
 */
export function parseProviderString(
  value: string | undefined,
): ProviderType | null {
  const normalized = value?.toLowerCase()?.trim();
  switch (normalized) {
    case 'opencode':
      return 'opencode';
    case 'copilot-cli':
    case 'copilot':
      return 'copilot-cli';
    case 'claude-sdk':
    case 'claude':
      return 'claude-sdk';
    case 'standalone':
      return 'standalone';
    default:
      return null;
  }
}

/**
 * Detect provider type from HTTP request headers.
 * This allows different AI providers to be identified automatically
 * without manual switching in the desktop app settings.
 *
 * OpenCode MCP config example:
 * ```json
 * {
 *   "mcp": {
 *     "interactive-desktop": {
 *       "type": "remote",
 *       "url": "http://localhost:3100/mcp",
 *       "headers": { "X-IMCP-Provider": "opencode" }
 *     }
 *   }
 * }
 * ```
 *
 * Copilot CLI MCP config example:
 * ```json
 * {
 *   "mcpServers": {
 *     "interactive-desktop": {
 *       "url": "http://localhost:3100/mcp",
 *       "headers": { "X-IMCP-Provider": "copilot-cli" }
 *     }
 *   }
 * }
 * ```
 */
export function detectProviderFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): ProviderType | null {
  // Check for X-IMCP-Provider header (case-insensitive header name)
  const headerValue =
    headers['x-imcp-provider'] ??
    headers['X-IMCP-Provider'] ??
    headers['X-Imcp-Provider'];
  if (typeof headerValue === 'string') {
    return parseProviderString(headerValue);
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return parseProviderString(headerValue[0]);
  }
  return null;
}

/**
 * Determine the effective provider type for a connection.
 * Priority order:
 * 1. X-IMCP-Provider HTTP header (per-connection identification)
 * 2. Global agentBackend setting (fallback for backwards compatibility)
 */
export function getEffectiveProvider(
  globalBackend: AgentBackend,
  requestHeaders?: Record<string, string | string[] | undefined>,
): ProviderType {
  // 1. Try HTTP header first (per-connection provider identification)
  if (requestHeaders) {
    const headerProvider = detectProviderFromHeaders(requestHeaders);
    if (headerProvider) {
      return headerProvider;
    }
  }

  // 2. Fall back to global setting mapping
  switch (globalBackend) {
    case 'opencode':
      return 'opencode';
    case 'claude_sdk':
      return 'claude-sdk';
    default:
      return 'standalone';
  }
}
