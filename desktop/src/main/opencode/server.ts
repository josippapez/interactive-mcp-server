/**
 * Manages an `opencode serve` child process so the desktop app can
 * auto-start the OpenCode HTTP API without the user running it manually.
 *
 * Lifecycle:
 *   startOpenCodeServer(port)  — spawn `opencode serve --port <port>` if not already running
 *   stopOpenCodeServer()       — kill the child process gracefully
 *   isOpenCodeServerRunning()  — check if the managed process is alive
 *
 * Binary resolution order:
 *   1. Bundled binary in app resources (resources/bin/opencode)
 *   2. User's ~/.opencode/bin/opencode
 *   3. 'opencode' on PATH
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

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

  // Build an augmented PATH so that opencode (and its spawned MCP servers)
  // can find tools like npx, node, etc. even when launched from macOS Dock/Finder.
  // Electron apps launched this way inherit a minimal PATH that excludes
  // user-installed tools from Homebrew, nvm, fnm, volta, etc.
  const augmentedEnv = buildAugmentedEnv();

  child = spawn(opencodeBin, ['serve', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false, // die with the parent
    cwd: spawnCwd,
    env: augmentedEnv,
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
 *
 * Sends SIGTERM first; if the child hasn't exited within
 * `SIGKILL_GRACE_MS`, escalates to SIGKILL. This prevents the Electron
 * app from hanging on quit when OpenCode ignores or slow-walks SIGTERM.
 */
const SIGKILL_GRACE_MS = 500;
export function stopOpenCodeServer(): void {
  if (!child) return;

  console.log('[opencode-server] Stopping opencode serve...');
  const dying = child;
  try {
    dying.kill('SIGTERM');
  } catch {
    // process may already be dead
  }

  // Escalate to SIGKILL if the child is still alive after the grace period.
  // Using `unref` so this timer itself does not keep the event loop alive.
  const killTimer = setTimeout(() => {
    if (dying.exitCode === null && dying.signalCode === null) {
      console.warn('[opencode-server] SIGTERM grace expired; sending SIGKILL.');
      try {
        dying.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
  }, SIGKILL_GRACE_MS);
  (killTimer as unknown as { unref?: () => void }).unref?.();

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

/**
 * Get the path to the bundled OpenCode binary in app resources.
 * In production, this is inside the app bundle's resources directory.
 * In development, it's in the project's resources/bin directory.
 */
function getBundledOpenCodePath(): string | null {
  const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';

  // In packaged app: resources are in the extraResources directory
  // app.isPackaged is true when running from a built app
  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    const packagedCandidates = [
      // Current electron-builder output for extraResources: Resources/resources/bin/opencode
      join(resourcesPath, 'resources', 'bin', binaryName),
      // Legacy/direct expectation: Resources/bin/opencode
      join(resourcesPath, 'bin', binaryName),
    ];

    for (const bundledPath of packagedCandidates) {
      if (existsSync(bundledPath)) {
        return bundledPath;
      }
    }
  } else {
    // In development: check the project's resources/bin directory
    // __dirname is .../out/main/ during dev, so go up to desktop/
    const devPath = join(__dirname, '..', '..', 'resources', 'bin', binaryName);
    if (existsSync(devPath)) {
      return devPath;
    }
  }

  return null;
}

function resolveOpenCodeBin(): string | null {
  // 1. Check for bundled binary first (preferred)
  const bundled = getBundledOpenCodePath();
  if (bundled) {
    console.log(`[opencode-server] Using bundled binary: ${bundled}`);
    return bundled;
  }

  // 2. Check common install locations
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

/**
 * Build an environment object with an augmented PATH.
 *
 * When Electron apps are launched from macOS Dock/Finder (or at login),
 * they inherit a minimal PATH that often lacks user-installed tools.
 * This function adds common Node.js version manager paths and Homebrew
 * locations so that `npx`, `node`, etc. are available to spawned processes.
 */
function buildAugmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const currentPath = env.PATH ?? '';

  // Common paths where Node.js tools (npx, node) might be installed
  const additionalPaths: string[] = [];

  if (process.platform === 'darwin' || process.platform === 'linux') {
    // Homebrew (macOS Intel and Apple Silicon)
    additionalPaths.push('/opt/homebrew/bin');
    additionalPaths.push('/usr/local/bin');

    // nvm - Node Version Manager
    if (home) {
      additionalPaths.push(`${home}/.nvm/current/bin`);
      // nvm default version symlink
      const nvmDir = process.env.NVM_DIR ?? `${home}/.nvm`;
      additionalPaths.push(`${nvmDir}/current/bin`);
    }

    // fnm - Fast Node Manager
    if (home) {
      additionalPaths.push(`${home}/.fnm/current/bin`);
      additionalPaths.push(
        `${home}/Library/Application Support/fnm/current/bin`,
      );
    }

    // volta
    if (home) {
      additionalPaths.push(`${home}/.volta/bin`);
    }

    // asdf
    if (home) {
      additionalPaths.push(`${home}/.asdf/shims`);
    }

    // mise (formerly rtx)
    if (home) {
      additionalPaths.push(`${home}/.local/share/mise/shims`);
    }

    // Standard local bin
    if (home) {
      additionalPaths.push(`${home}/.local/bin`);
    }

    // n - Node version manager
    if (home) {
      additionalPaths.push(`${home}/n/bin`);
    }
    additionalPaths.push('/usr/local/n/bin');
  } else if (process.platform === 'win32') {
    // Windows: npm global packages, common Node.js install paths
    if (home) {
      additionalPaths.push(`${home}\\AppData\\Roaming\\npm`);
    }
    additionalPaths.push('C:\\Program Files\\nodejs');
    additionalPaths.push('C:\\Program Files (x86)\\nodejs');
  }

  // Filter out paths that are already in PATH and empty strings
  const uniqueNewPaths = additionalPaths.filter(
    (p) => p && !currentPath.includes(p),
  );

  if (uniqueNewPaths.length > 0) {
    const separator = process.platform === 'win32' ? ';' : ':';
    env.PATH = [...uniqueNewPaths, currentPath].join(separator);
  }

  return env;
}
