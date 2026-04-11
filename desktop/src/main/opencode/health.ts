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
  const url = `http://localhost:${openCodePort}/global/health`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        available: true,
        healthy: false,
        version: null,
        error: `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as { healthy?: boolean; version?: string };

    return {
      available: true,
      healthy: data.healthy === true,
      version: typeof data.version === 'string' ? data.version : null,
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
