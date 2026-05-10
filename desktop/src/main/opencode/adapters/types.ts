/**
 * `OpenCodeServerAdapter` — Adapter pattern for the OpenCode HTTP server.
 *
 * The facade (`../server-facade.ts`) talks to the world through this single
 * interface. The selector (`./selector.ts`) chooses the concrete adapter
 * based on `RUNTIME_KIND` (see `../runtime-mode.ts`):
 *
 *   - Mode A (`in-process-utility`)   → `utility-rpc-adapter`
 *     The runtime lives inside the backend utility process. Main reaches
 *     it via the existing `opencode.server.*` Bridge RPCs.
 *
 *   - Mode B (`dedicated-utility`)    → `main-host-adapter`
 *     Main owns a forked `opencode-host` utility (sibling of backend) and
 *     uses `ManagedProcess` + `ForkedUtilityStrategy` to drive its
 *     lifecycle.
 *
 *   - Mode C (`native-subprocess`)    → `main-host-adapter`
 *     Same lifecycle plumbing as Mode B; `NativeBinaryStrategy` swaps in
 *     once that strategy is implemented (see `strategies/native-binary.ts`).
 *
 * Adapter contract is intentionally minimal — only what the facade exposes
 * to the rest of the app. Anything mode-specific (Bridge transport, child
 * pid, log fan-out) is hidden behind the adapter.
 *
 * Lifecycle expectations:
 *   - `start(port)` must be idempotent: same-port call is a no-op; different
 *     port stops the previous instance first.
 *   - `stop()` must never throw. Shutdown paths fire-and-forget; throwing
 *     would block Electron's `before-quit`.
 *   - `isRunning()` and `getUrl()` must be cheap synchronous reads. Callers
 *     poll these from health probes and the renderer.
 */

export interface OpenCodeServerAdapter {
  /**
   * Boot the OpenCode HTTP server on `port`. Idempotent: same-port call is
   * a no-op; different-port call stops the previous instance first.
   *
   * Resolves once the server is alive AND advertising its URL. Adapters
   * that own a child process MUST also propagate the URL into the
   * appropriate URL subject before resolving.
   */
  start(port: number): Promise<void>;

  /**
   * Stop the running server and release the port. MUST swallow errors —
   * shutdown paths cannot tolerate a thrown rejection.
   */
  stop(): Promise<void>;

  /**
   * Whether a managed server is currently live. Cheap synchronous read.
   */
  isRunning(): boolean;

  /**
   * Base URL of the running server (e.g. `http://127.0.0.1:4096`), or
   * `null` when not running. Cheap synchronous read.
   */
  getUrl(): string | null;

  /**
   * The actually-bound port (may differ from the value passed to `start`
   * if the requested port was in use and we probed upward). Returns `null`
   * when no server is running.
   */
  getResolvedPort(): number | null;
}
