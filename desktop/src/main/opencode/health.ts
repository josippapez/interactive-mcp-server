/**
 * Health check for the OpenCode server.
 *
 * Uses a raw fetch call to check if the server is running and responsive.
 * The SDK doesn't expose a health endpoint, so we use session.list as a proxy.
 */

import { getClient } from './sdk-client';

export interface OpenCodeHealthStatus {
  available: boolean;
  healthy: boolean;
  version: string | null;
  error?: string;
}

/**
 * Check the health of the OpenCode server.
 *
 * Uses session.list() as a health check proxy since the SDK doesn't
 * expose a dedicated health endpoint.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @returns Health status including availability, health, and version
 */
export async function checkOpenCodeHealth(
  openCodePort: number,
): Promise<OpenCodeHealthStatus> {
  try {
    const client = getClient(openCodePort);
    // Use session.list() as a health check - if we can list sessions,
    // the server is healthy
    const response = await client.session.list(undefined, {
      signal: AbortSignal.timeout(3000),
    });

    if (response.error) {
      return {
        available: false,
        healthy: false,
        version: null,
        error: 'Health check failed: ' + String(response.error),
      };
    }

    // Server responded successfully
    return {
      available: true,
      healthy: true,
      version: null, // Version not available from session.list
    };
  } catch (err) {
    return {
      available: false,
      healthy: false,
      version: null,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
