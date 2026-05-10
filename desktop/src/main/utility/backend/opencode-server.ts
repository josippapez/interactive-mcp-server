/**
 * Backend-side facade for the in-process OpenCode runtime (Mode A).
 *
 * Architecture context: this file is only meaningful when
 * `RUNTIME_KIND === 'in-process-utility'` (Mode A). In that mode the
 * backend utility process hosts `Server.listen()` directly. Main reaches
 * this facade via the `opencode.server.*` Bridge RPCs registered in
 * `./opencode-server-rpc.ts`, which are themselves only registered when
 * Mode A is active (see `entry.ts`).
 *
 * In Mode B/C the runtime lives in the MAIN process (forked utility or
 * native binary). The backend never instantiates the runtime; it only
 * mirrors the URL via the `opencode.url.set` Bridge event handled in
 * `./opencode/url-bridge-handler.ts`. Importing this file from Mode B/C
 * code paths is harmless (lazy `getRuntime()`) but should not happen.
 *
 * This module's three functions form the Mode A wire contract — keep
 * them stable; the corresponding main-side proxy is the
 * `UtilityRpcAdapter` in `src/main/opencode/adapters/`.
 */

import { createOpenCodeRuntime } from '../../opencode/runtime/factory';
import { RUNTIME_KIND } from '../../opencode/runtime-mode';
import type { OpenCodeRuntime } from '../../opencode/runtime/types';

let runtime: OpenCodeRuntime | null = null;
let runtimePromise: Promise<OpenCodeRuntime> | null = null;

async function getRuntime(): Promise<OpenCodeRuntime> {
  if (runtime) return runtime;
  if (!runtimePromise) {
    // RUNTIME_KIND is the single source of truth (`opencode/runtime-mode.ts`).
    // For Mode A this resolves to InProcessOpenCodeRuntime. The factory
    // refuses Mode B/C from here (topology guard) — that's intentional.
    runtimePromise = createOpenCodeRuntime(RUNTIME_KIND).then((r) => {
      runtime = r;
      return r;
    });
  }
  return runtimePromise;
}

/**
 * Boot the OpenCode HTTP server on `port`.
 *
 * Idempotent: calling twice with the same port is a no-op. Calling with a
 * different port stops the previous instance first.
 */
export async function startOpenCodeServer(port: number): Promise<void> {
  const r = await getRuntime();
  await r.start(port);
}

/**
 * Stop the running OpenCode server and release the port.
 *
 * Errors during stop are logged by the runtime but never thrown — shutdown
 * must not block Electron's quit sequence.
 */
export async function stopOpenCodeServer(): Promise<void> {
  // Avoid forcing runtime construction during shutdown if it never started.
  if (!runtime) return;
  await runtime.stop();
}

/**
 * Whether a managed OpenCode server is currently live.
 *
 * Returns `false` when the runtime has not been instantiated yet (i.e.
 * `startOpenCodeServer` was never called).
 */
export function isOpenCodeServerRunning(): boolean {
  return runtime?.isRunning() ?? false;
}

/**
 * Base URL of the running server (e.g. `http://127.0.0.1:4096`), or
 * `null` when no server is running.
 */
export function getOpenCodeServerUrl(): string | null {
  return runtime?.getUrl() ?? null;
}
