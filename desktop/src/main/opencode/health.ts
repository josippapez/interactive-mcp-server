/**
 * Health check for the OpenCode server.
 *
 * Hits the lightweight `GET /global/health` endpoint (returns
 * `{ healthy: true, version: string }`) instead of proxying through
 * `session.list`. This avoids DB / workspace-scan latency on cold start
 * and matches the upstream `packages/desktop-electron` pattern.
 */

export interface OpenCodeHealthStatus {
  available: boolean;
  healthy: boolean;
  version: string | null;
  error?: string;
}

/**
 * Default per-attempt timeout (ms). The cold-start probe can race the
 * in-process server's DB/workspace init, so we allow callers to pass
 * a larger timeout for startup waits.
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Check the health of the OpenCode server.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @param timeoutMs - Optional per-attempt timeout override (default 5s)
 */
export async function checkOpenCodeHealth(
  openCodePort: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<OpenCodeHealthStatus> {
  let healthUrl: URL;
  try {
    healthUrl = new URL(`http://127.0.0.1:${openCodePort}/global/health`);
  } catch (err) {
    return {
      available: false,
      healthy: false,
      version: null,
      error: err instanceof Error ? err.message : 'Invalid health URL',
    };
  }

  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        available: false,
        healthy: false,
        version: null,
        error: `Health check failed: HTTP ${res.status}`,
      };
    }

    // Parse the body opportunistically — older servers may not include
    // a version field. A successful 200 is sufficient for `available`.
    let version: string | null = null;
    try {
      const body = (await res.json()) as { version?: unknown };
      if (typeof body.version === 'string') {
        version = body.version;
      }
    } catch {
      // Non-JSON response is still a healthy server for our purposes.
    }

    return {
      available: true,
      healthy: true,
      version,
    };
  } catch (err) {
    return {
      available: false,
      healthy: false,
      version: null,
      error:
        err instanceof Error
          ? `Health check failed: ${err.message}`
          : 'Connection failed',
    };
  }
}
