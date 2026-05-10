/**
 * Health check for the OpenCode server.
 *
 * Hits the lightweight `GET /global/health` endpoint (returns
 * `{ healthy: true, version: string }`) instead of proxying through
 * `session.list`. This avoids DB / workspace-scan latency on cold start
 * and matches the upstream `packages/desktop-electron` pattern.
 *
 * # Why this uses `node:http` instead of `fetch`
 *
 * Empirically, `globalThis.fetch` (which uses undici) loses the ability
 * to reach loopback after ~30s of healthy probing in Electron's main
 * process — `fetch failed` with `AggregateError [ECONNREFUSED]` across
 * both v6 (::1) and v4 (127.0.0.1), while the host's own intra-process
 * self-probe succeeds against the same port.
 *
 * Investigation:
 * - Reproduced across both `utilityProcess.fork` (Mode B) and
 *   `child_process.fork` (Mode B'), so it is NOT an Electron utility
 *   sandbox issue.
 * - Disabling undici keep-alive (`Agent({ keepAliveTimeout: 1, ... })`
 *   per-call) did NOT change the 30s failure timing — so it is NOT a
 *   stale undici socket pool entry.
 * - Same probe code from the host process itself succeeds indefinitely.
 *
 * Hypothesis remaining: undici (or its happy-eyeballs dual-stack
 * implementation) caches some state in Electron main that goes bad
 * after ~30s. `node:http` bypasses undici entirely — it issues a raw
 * socket connect.
 *
 * If THIS path also fails at the same 30s mark, the cause is below
 * undici (libuv, macOS network sandbox, or Electron's network
 * integration); if it succeeds, the cause was undici.
 */

import { request as httpRequest } from 'node:http';
import { Buffer } from 'node:buffer';

import { buildOpenCodeBasicAuthHeader } from './auth-header';

export interface OpenCodeHealthStatus {
  available: boolean;
  healthy: boolean;
  version: string | null;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

interface ProbeResult {
  status: number;
  body: string;
}

/**
 * One-shot HTTP GET against `127.0.0.1:<port><path>`. Returns the status
 * code and body string. Rejects on connection error or timeout.
 *
 * Uses `node:http` directly (no agent reuse) to bypass undici. Forces
 * IPv4 by passing `127.0.0.1` literally; we never want happy-eyeballs
 * here because the host binds only to v4.
 */
function probeOnce(
  port: number,
  path: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };

    const auth = buildOpenCodeBasicAuthHeader();
    const baseHeaders: Record<string, string> = { Connection: 'close' };
    if (auth) baseHeaders.Authorization = auth;

    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        // Disable agent entirely — every probe gets a fresh socket.
        agent: false,
        // Match the previous `fetch` per-attempt timeout.
        timeout: timeoutMs,
        // Tell the server to close the connection after the response so
        // we don't leave half-open sockets pooled at OS level.
        // Mode C: include Basic-auth header so the binary's password
        // gate accepts the probe (otherwise 401 even on `/global/health`).
        headers: baseHeaders,
        family: 4,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        });
        res.on('error', (err) => {
          finish(() => reject(err));
        });
      },
    );

    req.on('error', (err) => {
      finish(() => reject(err));
    });
    req.on('timeout', () => {
      finish(() => {
        req.destroy(new Error(`probe timed out after ${timeoutMs}ms`));
      });
    });

    req.end();
  });
}

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
  if (!Number.isInteger(openCodePort) || openCodePort <= 0) {
    return {
      available: false,
      healthy: false,
      version: null,
      error: `Invalid OpenCode port: ${String(openCodePort)}`,
    };
  }

  try {
    const { status, body } = await probeOnce(
      openCodePort,
      '/global/health',
      timeoutMs,
    );

    if (status < 200 || status >= 300) {
      return {
        available: false,
        healthy: false,
        version: null,
        error: `Health check failed: HTTP ${status}`,
      };
    }

    let version: string | null = null;
    try {
      const parsed = JSON.parse(body) as { version?: unknown };
      if (typeof parsed.version === 'string') {
        version = parsed.version;
      }
    } catch {
      // Non-JSON body is fine; 2xx is enough for `available`.
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
