/**
 * Manages an `opencode serve` child process so the desktop app can
 * auto-start the OpenCode HTTP API without the user running it manually.
 *
 * Lifecycle:
 *   startOpenCodeServer(port)  — spawn `opencode serve --port <port>` if not already running
 *   stopOpenCodeServer()       — kill the child process gracefully
 *   isOpenCodeServerRunning()  — check if the managed process is alive
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';

let child: ChildProcess | null = null;
let managedPort: number | null = null;

/**
 * Spawn `opencode serve --port <port>` as a child process.
 * If a managed process is already running on the same port, this is a no-op.
 * If the port changed, the old process is killed first.
 */
export function startOpenCodeServer(port: number): void {
  if (child && managedPort === port) {
    // Already running on the right port
    return;
  }

  // Kill existing process if port changed
  if (child) {
    stopOpenCodeServer();
  }

  const opencodeBin = resolveOpenCodeBin();
  if (!opencodeBin) {
    console.error(
      '[opencode-server] Could not find opencode binary. Is it installed?',
    );
    return;
  }

  console.log(
    `[opencode-server] Starting opencode serve --port ${port} (bin: ${opencodeBin})`,
  );

  // Use the user's home directory as cwd so that opencode serve doesn't
  // inherit '/' when the app is launched from the macOS Dock or at login.
  const spawnCwd = process.env.HOME ?? process.env.USERPROFILE ?? '/';

  child = spawn(opencodeBin, ['serve', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false, // die with the parent
    cwd: spawnCwd,
  });

  managedPort = port;

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[opencode-server] ${line}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`[opencode-server] ${line}`);
  });

  child.on('exit', (code, signal) => {
    console.log(
      `[opencode-server] Process exited (code=${code}, signal=${signal})`,
    );
    child = null;
    managedPort = null;
  });

  child.on('error', (err) => {
    console.error(`[opencode-server] Failed to start: ${err.message}`);
    child = null;
    managedPort = null;
  });
}

/**
 * Gracefully stop the managed opencode serve process.
 */
export function stopOpenCodeServer(): void {
  if (!child) return;

  console.log('[opencode-server] Stopping opencode serve...');
  try {
    child.kill('SIGTERM');
  } catch {
    // process may already be dead
  }
  child = null;
  managedPort = null;
}

/**
 * Check if the managed process is alive.
 */
export function isOpenCodeServerRunning(): boolean {
  return child !== null && child.exitCode === null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveOpenCodeBin(): string | null {
  // 1. Check common install locations
  const candidates = [
    // macOS / Linux typical install path
    `${process.env.HOME}/.opencode/bin/opencode`,
    // If opencode is on PATH, just use the name
    'opencode',
  ];

  // Try to find one that exists
  for (const candidate of candidates) {
    if (candidate.startsWith('/') && existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: assume it's on PATH
  return 'opencode';
}
