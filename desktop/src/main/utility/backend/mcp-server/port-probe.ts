/**
 * Port-probe helper for the MCP HTTP listener.
 *
 * Why this exists:
 *
 * Previously the MCP server called `app.listen(3100)` directly. When two
 * Eden instances ran simultaneously (dev + prod), the second one would hit
 * EADDRINUSE and the utility process would crash. The supervisor would
 * then restart the utility, which would crash again — restart loop.
 *
 * This module probes upward from a starting port until it finds one that
 * is free, then returns it. We never touch foreign processes — if some
 * other application on the user's machine is using 3100, we just bind on
 * 3101 (or 3102, …).
 *
 * Scope:
 *   - Lives in the utility process (no Electron / no `app.getPath`).
 *   - No pidfile / lsof — those belong to the OpenCode resolver in main.
 *     The MCP server is a singleton inside the utility process; it dies
 *     cleanly with the parent Electron app, so stale-child reclaim isn't
 *     applicable here.
 */

import { createServer } from 'node:net';

const MAX_PROBE_ATTEMPTS = 100;

export interface McpPortResolution {
  /** The port we successfully bound (may differ from `startPort`). */
  port: number;
  /** Number of ports we tried before finding one that was free. */
  attempts: number;
}

/**
 * Try to bind 127.0.0.1:port. Resolves true if free, false if in use.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const settle = (free: boolean): void => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve(free);
    };

    server.once('error', () => settle(false));
    server.once('listening', () => settle(true));

    try {
      server.listen(port, '127.0.0.1');
    } catch {
      settle(false);
    }
  });
}

/**
 * Probe upward from `startPort` for a free port. Returns the first free
 * port found, or throws if none is available within `MAX_PROBE_ATTEMPTS`.
 *
 * Pure function — no I/O beyond the bind probe. Safe to call from the
 * utility process before `app.listen`.
 */
export async function resolveMcpPort(
  startPort: number,
  log?: (msg: string) => void,
): Promise<McpPortResolution> {
  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt += 1) {
    const candidate = startPort + attempt;

    const free = await isPortFree(candidate);
    if (free) {
      if (attempt > 0) {
        log?.(
          `[mcp-port-probe] port=${startPort} in use; bound on port=${candidate} after ${attempt + 1} attempt(s)`,
        );
      }
      return { port: candidate, attempts: attempt + 1 };
    }
  }
  throw new Error(
    `[mcp-port-probe] no free port found in range ${startPort}..${
      startPort + MAX_PROBE_ATTEMPTS - 1
    }`,
  );
}
