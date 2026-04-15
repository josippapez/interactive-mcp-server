import {
  buildOpenCodePortCandidates,
  fetchJsonFromAllReachable,
} from './endpoints';

/**
 * Health check for the OpenCode server.
 *
 * Uses the OpenCode HTTP API at GET /global/health to check
 * if the server is running and responsive.
 */

export interface OpenCodeHealthStatus {
  available: boolean;
  healthy: boolean;
  version: string | null;
  activePort?: number | null;
  reachablePorts?: number[];
  error?: string;
}

/**
 * Check the health of the OpenCode server.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @returns Health status including availability, health, and version
 */
export async function checkOpenCodeHealth(
  openCodePort: number,
): Promise<OpenCodeHealthStatus> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const results = await fetchJsonFromAllReachable<{
      healthy?: boolean;
      version?: string;
    }>(ports, '/global/health', 3000);
    if (results.length === 0) {
      return {
        available: false,
        healthy: false,
        version: null,
        activePort: null,
        reachablePorts: [],
        error: 'Connection failed',
      };
    }

    const firstHealthy = results.find((result) => result.data.healthy === true);
    const selected = firstHealthy ?? results[0];

    return {
      available: true,
      healthy: selected.data.healthy === true,
      version:
        typeof selected.data.version === 'string'
          ? selected.data.version
          : null,
      activePort: selected.port,
      reachablePorts: results.map((result) => result.port),
    };
  } catch (err) {
    // Server not reachable
    const isTimeout = (err as { name?: string }).name === 'AbortError';
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      healthy: false,
      version: null,
      error: isTimeout
        ? 'Connection timeout'
        : `Connection failed: ${errorMessage}`,
    };
  }
}
