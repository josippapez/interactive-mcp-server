/**
 * In-process OpenCode runtime.
 *
 * Boots the OpenCode HTTP API by dynamic-importing `virtual:opencode-server`
 * (rewritten by electron-vite to the prebuilt node bundle) and calling
 * `Server.listen()` inside the Electron utility process.
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
 * On Electron Dock/Finder launch, XDG_STATE_HOME is pinned to the Electron
 * userData directory so per-user OpenCode state follows app-data conventions
 * instead of writing to `~/.local/share`. This matches the upstream
 * `packages/desktop-electron` implementation.
 *
 * IMPORTANT: this is the ONLY file that may import `virtual:opencode-server`.
 * Every other consumer must go through the `OpenCodeRuntime` facade in
 * `./types.ts` (composed via `./factory.ts`).
 */

import { getSettingsSnapshot } from '../../utility/backend/settings-mirror';
import type { OpenCodeRuntime } from './types';

type Listener = {
  url: string;
  stop: () => Promise<void> | void;
};

export class InProcessOpenCodeRuntime implements OpenCodeRuntime {
  private listener: Listener | null = null;
  private managedPort: number | null = null;
  private startingPromise: Promise<void> | null = null;

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
  async start(port: number): Promise<void> {
    if (this.listener && this.managedPort === port) {
      return;
    }

    if (this.startingPromise) {
      await this.startingPromise;
      if (this.listener && this.managedPort === port) return;
    }

    if (this.listener) {
      await this.stop();
    }

    this.startingPromise = (async () => {
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
          `[opencode-runtime:in-process] Log.init failed (continuing): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      console.log(
        `[opencode-runtime:in-process] Starting Server.listen on 127.0.0.1:${port}`,
      );

      this.listener = (await mod.Server.listen({
        port,
        hostname: '127.0.0.1',
      })) as Listener;
      this.managedPort = port;

      console.log(
        `[opencode-runtime:in-process] Ready at ${this.listener.url}`,
      );
    })();

    try {
      await this.startingPromise;
    } finally {
      this.startingPromise = null;
    }
  }

  /**
   * Stop the in-process listener and release the port.
   *
   * Errors from `listener.stop()` are logged but never thrown — shutdown must
   * not block Electron's quit sequence.
   */
  async stop(): Promise<void> {
    if (!this.listener) return;

    console.log('[opencode-runtime:in-process] Stopping listener...');
    const dying = this.listener;
    this.listener = null;
    this.managedPort = null;

    try {
      await dying.stop();
    } catch (err) {
      console.warn(
        `[opencode-runtime:in-process] listener.stop() threw (ignored): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  isRunning(): boolean {
    return this.listener !== null;
  }

  getUrl(): string | null {
    return this.listener?.url ?? null;
  }
}

// ---------------------------------------------------------------------------
// Helpers (in-process specific — not part of the runtime facade)
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
 * PATH: already patched in the main process at startup via fix-path, so
 * the in-process runtime inherits the corrected PATH automatically.
 */
function prepareServerEnv(): void {
  const { userDataPath } = getSettingsSnapshot();

  // OpenCode-specific env vars. The PATH is already patched in the main
  // process at startup via fix-path, and we inherited it.
  process.env.XDG_STATE_HOME = userDataPath;
  process.env.OPENCODE_CLIENT = 'desktop';
}
