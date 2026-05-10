/**
 * Find a free TCP port and reclaim our own stale OpenCode children.
 *
 * Why this module exists:
 *
 * Previous behavior in `native-binary.ts` was to *blanket* SIGKILL any
 * process holding LISTEN on the configured port (default 4096). That
 * caused dev and packaged builds to murder each other when both ran at
 * once, producing the 401 / supervisor-restart / SIGKILL loop the user
 * reported.
 *
 * New behavior:
 *   1. Read the pidfile of our own most-recent OpenCode child.
 *   2. If the pidfile names a process that is still alive AND holding
 *      the requested port, SIGKILL it (we own it; reclaim our port).
 *   3. Probe upward from `startPort` looking for a free port via TCP
 *      bind probe. We never touch ports held by foreign processes.
 *   4. Write the new child's PID to the pidfile after spawn.
 *
 * The pidfile lives under `userDataPath` so it follows the same per-app
 * scoping as everything else.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const PIDFILE_NAME = 'opencode.pid';
const MAX_PROBE_ATTEMPTS = 100;

export interface PortResolution {
  port: number;
  reclaimedPid?: number;
  attempts: number;
}

/**
 * Try to bind to `port` on 127.0.0.1. Returns true if free, false if in use.
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
      server.listen({ port, host: '127.0.0.1', exclusive: true });
    } catch {
      settle(false);
    }
  });
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    // EPERM means the pid exists but we can't signal it — still alive.
    return code === 'EPERM';
  }
}

function pidsHoldingPort(port: number): number[] {
  if (process.platform === 'win32') {
    // Windows: parse `netstat -ano` for `LISTENING`. Returns PIDs only.
    try {
      const raw = execFileSync('netstat', ['-ano'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const out: number[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        if (!line.includes(`:${port} `)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number.parseInt(parts[parts.length - 1], 10);
        if (Number.isFinite(pid) && pid > 0) out.push(pid);
      }
      return out;
    } catch {
      return [];
    }
  }

  // POSIX: `lsof -t -nP -iTCP:<port> -sTCP:LISTEN` returns PIDs only.
  try {
    const raw = execFileSync(
      'lsof',
      ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** Read the recorded PID of our previous OpenCode child, if any. */
function readPidfile(userDataPath: string): number | null {
  const path = join(userDataPath, PIDFILE_NAME);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writePidfile(userDataPath: string, pid: number): void {
  try {
    writeFileSync(join(userDataPath, PIDFILE_NAME), String(pid), 'utf8');
  } catch {
    /* non-fatal */
  }
}

export function clearPidfile(userDataPath: string): void {
  try {
    unlinkSync(join(userDataPath, PIDFILE_NAME));
  } catch {
    /* already gone */
  }
}

/**
 * Reclaim our own stale child if it still holds the port. Returns the
 * reclaimed PID if a kill occurred, otherwise null.
 *
 * Only kills PIDs that match the recorded pidfile AND are currently
 * holding `port`. Foreign processes are left alone.
 */
export function reclaimOwnStaleChild(
  userDataPath: string,
  port: number,
  log: (msg: string) => void,
): number | null {
  const recordedPid = readPidfile(userDataPath);
  if (recordedPid === null) return null;
  if (!pidIsAlive(recordedPid)) {
    clearPidfile(userDataPath);
    return null;
  }
  const holders = pidsHoldingPort(port);
  if (!holders.includes(recordedPid)) return null;

  log(
    `[port-resolver] reclaiming own stale opencode child pid=${recordedPid} on port=${port}`,
  );
  try {
    process.kill(recordedPid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  // Brief pause for kernel to release the LISTEN socket.
  const start = Date.now();
  while (Date.now() - start < 250) {
    /* spin */
  }
  clearPidfile(userDataPath);
  return recordedPid;
}

/**
 * Resolve a free port to use for OpenCode.
 *
 * Step 1: try to reclaim our own stale child if it's pinning `startPort`.
 * Step 2: probe upward from `startPort` for the first free port (up to
 *         `startPort + MAX_PROBE_ATTEMPTS - 1`).
 *
 * Throws if no port is free in the probe range.
 */
export async function resolveOpenCodePort(opts: {
  userDataPath: string;
  startPort: number;
  log: (msg: string) => void;
  maxAttempts?: number;
}): Promise<PortResolution> {
  const { userDataPath, startPort, log } = opts;
  const max = opts.maxAttempts ?? MAX_PROBE_ATTEMPTS;

  const reclaimedPid =
    reclaimOwnStaleChild(userDataPath, startPort, log) ?? undefined;

  for (let i = 0; i < max; i += 1) {
    const candidate = startPort + i;
    if (candidate < 1024 || candidate > 65535) break;

    const free = await isPortFree(candidate);
    if (free) {
      if (i > 0) {
        log(
          `[port-resolver] requested port=${startPort} in use; resolved to free port=${candidate} after ${i + 1} attempt(s)`,
        );
      }
      return { port: candidate, reclaimedPid, attempts: i + 1 };
    }
  }

  throw new Error(
    `[port-resolver] no free port found in range ${startPort}-${startPort + max - 1}`,
  );
}
