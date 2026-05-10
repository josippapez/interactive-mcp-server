/**
 * Public Facade for the OpenCode HTTP server lifecycle.
 *
 * This is the ONLY surface the rest of the app imports. It hides the
 * mode-selection branch (Mode A/B/C) behind a stable function signature,
 * matching the legacy `utility/opencode-server-client.ts` contract so
 * existing callers (`main/index.ts`, `ipc/handlers/settings-handlers.ts`)
 * don't need to change call shape — only the import path.
 *
 * Design intent:
 *   - Facade pattern: one entry point, one stable signature.
 *   - Adapter pattern: the work goes to a `OpenCodeServerAdapter`
 *     selected by `selectOpenCodeAdapter()` based on `RUNTIME_KIND`.
 *   - Lazy resolution: the adapter is selected on first call so import
 *     order doesn't force `electron.app` to be ready before main bootstrap.
 *
 * Concurrency:
 *   - `start()` is idempotent at the adapter layer; calling twice with
 *     the same port is a no-op.
 *   - `stop()` MUST never throw (Electron `before-quit` cannot tolerate
 *     a thrown rejection). Adapters wrap their stop paths accordingly.
 */

import { selectOpenCodeAdapter } from './adapters/selector';

/**
 * Boot the OpenCode HTTP server.
 *
 * `requestedPort` is a *starting hint*. If it's free we use it, otherwise the
 * adapter probes upward to the next free port. The actually-bound port is
 * returned and is also available afterwards via `getOpenCodeServerPort()`.
 *
 * Idempotent: calling twice with the same `requestedPort` is a no-op.
 * Calling with a different port stops the previous instance first.
 */
export async function startOpenCodeServer(
  requestedPort: number,
): Promise<number> {
  const adapter = selectOpenCodeAdapter();
  await adapter.start(requestedPort);
  // Adapter guarantees getResolvedPort() is non-null right after a successful
  // start(). Fall back to requestedPort defensively (Mode A — utility-rpc
  // adapter — currently returns null but uses the requested port verbatim).
  return adapter.getResolvedPort() ?? requestedPort;
}

/**
 * Stop the running OpenCode server and release the port.
 *
 * Errors during stop are logged by the adapter but never thrown —
 * shutdown must not block Electron's quit sequence.
 */
export async function stopOpenCodeServer(): Promise<void> {
  const adapter = selectOpenCodeAdapter();
  await adapter.stop();
}

/**
 * Whether a managed OpenCode server is currently live. Cheap synchronous
 * read backed by the adapter's local state.
 */
export function isOpenCodeServerRunning(): boolean {
  return selectOpenCodeAdapter().isRunning();
}

/**
 * Base URL of the running server (e.g. `http://127.0.0.1:4096`), or
 * `null` when no server is running.
 */
export function getOpenCodeServerUrl(): string | null {
  return selectOpenCodeAdapter().getUrl();
}

/**
 * Actually-bound port of the running OpenCode server, or `null` when not
 * running. May differ from the value passed to `startOpenCodeServer` if the
 * requested port was in use and the resolver probed upward.
 */
export function getOpenCodeServerPort(): number | null {
  return selectOpenCodeAdapter().getResolvedPort();
}
