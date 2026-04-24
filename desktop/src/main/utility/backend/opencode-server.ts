/**
 * Runs the OpenCode HTTP API in-process via `virtual:opencode-server`'s
 * `Server.listen()`. Replaces the old subprocess spawn model — the entire
 * OpenCode server now lives inside the Electron main-process Node runtime
 * (see `electron.vite.config.ts` for the virtual-module wiring).
 *
 * Why in-process:
 *   - No bundled per-platform binary (~70 MB smaller installs).
 *   - No spawn/health-check race on startup.
 *   - Crash isolation loss is acceptable (OS-level app relaunch handles it).
 *
 * Shell environment: When Electron is launched from macOS Dock/Spotlight (or
 * Linux app launchers), the PATH and other environment variables are minimal.
 * We probe the user's login shell to capture the full environment, which is
 * critical for spawning MCP servers that depend on `npx`, `node`, etc.
 *
 * Lifecycle:
 *   startOpenCodeServer(port)  — boots `Server.listen()` if not already running
 *   stopOpenCodeServer()       — calls `listener.stop()` and releases the port
 *   isOpenCodeServerRunning()  — whether a live listener exists
 *
 * On Electron Dock/Finder launch, XDG_STATE_HOME is pinned to the Electron
 * userData directory so per-user OpenCode state follows app-data conventions
 * instead of writing to `~/.local/share`. This matches the upstream
 * `packages/desktop-electron` implementation.
 */

import { getUserShell, loadShellEnv } from './shell-env';
import { getSettingsSnapshot } from './settings-mirror';

type Listener = {
  url: string;
  stop: () => Promise<void> | void;
};

let listener: Listener | null = null;
let managedPort: number | null = null;
let startingPromise: Promise<void> | null = null;

/**
 * Boot the in-process OpenCode server on `port`.
 *
 * Idempotent: if a listener is already running on the same port, resolves
 * immediately. If the requested port changed, the previous listener is
 * stopped first.
 *
 * Concurrent callers share the same in-flight startup promise so the
 * dynamic `virtual:opencode-server` import only runs once.
 */
export async function startOpenCodeServer(port: number): Promise<void> {
  if (listener && managedPort === port) {
    return;
  }

  if (startingPromise) {
    await startingPromise;
    if (listener && managedPort === port) return;
  }

  if (listener) {
    await stopOpenCodeServer();
  }

  startingPromise = (async () => {
    prepareServerEnv();

    // Dynamic import so the 17 MB bundle is only loaded when the user has
    // the OpenCode backend enabled. Some users run us with claude-agent-sdk
    // or copilot-cli and never touch OpenCode.
    const mod = await import('virtual:opencode-server');

    try {
      await mod.Log.init({ level: 'WARN' });
    } catch (err) {
      // Log init is best-effort — if it throws we still want to try to listen.
      console.warn(
        `[opencode-server] Log.init failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    console.log(
      `[opencode-server] Starting in-process Server.listen on 127.0.0.1:${port}`,
    );

    listener = (await mod.Server.listen({
      port,
      hostname: '127.0.0.1',
    })) as Listener;
    managedPort = port;

    console.log(`[opencode-server] Ready at ${listener.url}`);
  })();

  try {
    await startingPromise;
  } finally {
    startingPromise = null;
  }
}

/**
 * Stop the in-process listener and release the port.
 *
 * Errors from `listener.stop()` are logged but never thrown — shutdown must
 * not block Electron's quit sequence.
 */
export async function stopOpenCodeServer(): Promise<void> {
  if (!listener) return;

  console.log('[opencode-server] Stopping in-process listener...');
  const dying = listener;
  listener = null;
  managedPort = null;

  try {
    await dying.stop();
  } catch (err) {
    console.warn(
      `[opencode-server] listener.stop() threw (ignored): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Whether a managed listener is currently live.
 */
export function isOpenCodeServerRunning(): boolean {
  return listener !== null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set env vars the OpenCode server expects before we dynamic-import it.
 *
 * `XDG_STATE_HOME` pin-points OpenCode's per-user state dir at the Electron
 * userData path. Without it, the server writes to `~/.local/share` which is
 * surprising for desktop-app users (uninstalling the app leaves orphaned
 * state behind).
 *
 * `OPENCODE_CLIENT=desktop` tells the server it's embedded — some upstream
 * features (e.g. icon discovery, file-watcher) are gated on this.
 *
 * Shell environment: When Electron is launched from macOS Dock/Spotlight (or
 * Linux app launchers), the PATH and other environment variables are minimal.
 * We probe the user's login shell to capture the full environment. If shell
 * probing fails (timeout, nushell, misconfigured shell), we fall back to
 * augmenting PATH with common Node.js locations.
 */
function prepareServerEnv(): void {
  const { userDataPath } = getSettingsSnapshot();
  if (!userDataPath) {
    throw new Error(
      '[opencode-server] userDataPath missing from settings snapshot — did main forward it in the init envelope?',
    );
  }
  process.env.XDG_STATE_HOME = userDataPath;
  process.env.OPENCODE_CLIENT = 'desktop';

  // Only probe shell env on Unix-like systems
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return;
  }

  // Try to load the user's full shell environment
  const shell = getUserShell();
  const shellEnv = loadShellEnv(shell);

  if (shellEnv) {
    // Merge shell env into process.env, preserving any existing overrides
    // (like XDG_STATE_HOME and OPENCODE_CLIENT we just set)
    const preserved = {
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      OPENCODE_CLIENT: process.env.OPENCODE_CLIENT,
    };

    // Apply shell environment
    for (const [key, value] of Object.entries(shellEnv)) {
      if (!(key in preserved)) {
        process.env[key] = value;
      }
    }

    // Restore our explicit overrides
    Object.assign(process.env, preserved);

    console.log(
      `[opencode-server] Loaded shell environment from ${shell} (${Object.keys(shellEnv).length} vars)`,
    );
    return;
  }

  // Fallback: augment PATH with common Node.js locations
  // This covers cases where shell probing fails (timeout, nushell, etc.)
  console.log(
    '[opencode-server] Shell probing failed, falling back to PATH augmentation',
  );
  augmentPathFallback();
}

/**
 * Fallback PATH augmentation when shell probing fails.
 *
 * Prepends common Node.js paths to ensure `npx`, `node`, etc. are found.
 * Covers: Homebrew (Intel + Apple Silicon), nvm, volta, nodenv, fnm, asdf.
 */
function augmentPathFallback(): void {
  const home = process.env.HOME ?? '';
  const extraPaths = [
    // Homebrew (Apple Silicon)
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    // Homebrew (Intel)
    '/usr/local/bin',
    '/usr/local/sbin',
    // nvm (common default location)
    `${home}/.nvm/current/bin`,
    // volta
    `${home}/.volta/bin`,
    // nodenv
    `${home}/.nodenv/shims`,
    // fnm
    `${home}/.fnm/current/bin`,
    `${home}/Library/Application Support/fnm/current/bin`,
    // asdf
    `${home}/.asdf/shims`,
    // pnpm
    `${home}/.pnpm`,
    `${home}/Library/pnpm`,
    // npm global
    `${home}/.npm-global/bin`,
    // System paths
    '/usr/bin',
    '/bin',
  ].filter((p) => p.length > 0);

  const currentPath = process.env.PATH ?? '';
  const pathSet = new Set(currentPath.split(':').filter(Boolean));
  const newPaths = extraPaths.filter((p) => !pathSet.has(p));

  if (newPaths.length > 0) {
    process.env.PATH = [...newPaths, currentPath].filter(Boolean).join(':');
    console.log(
      `[opencode-server] Augmented PATH with ${newPaths.length} additional paths for MCP server spawning`,
    );
  }
}
