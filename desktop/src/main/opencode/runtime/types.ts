/**
 * OpenCodeRuntime — facade for booting the OpenCode HTTP API.
 *
 * Hosting modes (callers stay on the same lifecycle interface):
 *
 *   A. `in-process-utility` (CURRENT DEFAULT)
 *      - `Server.listen()` runs inside the **main backend utility process**
 *        (the one that also owns DB / MCP / SSE).
 *      - Smallest cold-start cost. OpenCode shares lifecycle with the rest
 *        of the backend; if it crashes, the whole utility goes down.
 *      - Implementation: `./in-process.ts`.
 *
 *   B. `dedicated-utility`
 *      - `Server.listen()` runs in **its own `utilityProcess.fork()`**, a
 *        sibling of the main utility process. Same JS bundle, same Node
 *        runtime, no per-platform binaries. Talks to main over a
 *        MessagePort `Bridge` for lifecycle, over HTTP (SDK clients) for
 *        actual API calls.
 *      - Crash isolation: an OpenCode crash leaves the rest of the backend
 *        alive; supervisor can respawn just the host.
 *      - Implementation: `./strategies/forked-utility.ts`.
 *
 *   B'. `forked-child`
 *      - Same JS bundle as Mode B, but spawned via Node's
 *        `child_process.fork()` instead of Electron's `utilityProcess.fork`.
 *        Escapes Electron's per-utility network sandbox on macOS, which
 *        empirically blocks long-lived cross-process loopback HTTP.
 *      - Structurally identical to Mode C (regular OS child process), so
 *        validating B' validates C's process model too.
 *      - Implementation: `./strategies/child-process-fork.ts`.
 *
 *   C. `native-subprocess` (NOT IMPLEMENTED)
 *      - `child_process.spawn` of a per-platform OpenCode CLI binary.
 *      - Strongest isolation, biggest installer, build-pipeline change.
 *      - Implementation: `./strategies/native-binary.ts` (stub).
 *
 * Mode selection lives in `./factory.ts`. Mode B/B'/C may only be created
 * from the main process — see `factory.ts` for the topology guard.
 */

export interface OpenCodeRuntime {
  /**
   * Boot the OpenCode HTTP server on `port`. Idempotent: same-port call
   * is a no-op; different-port call stops the previous instance first.
   */
  start(port: number): Promise<void>;

  /**
   * Stop the running server and release the port. Errors during stop are
   * logged by the runtime but never thrown — shutdown must not block
   * Electron's quit sequence.
   */
  stop(): Promise<void>;

  /** Whether a managed server is currently live. */
  isRunning(): boolean;

  /** Base URL of the running server, or `null` when not running. */
  getUrl(): string | null;
}

/**
 * Discriminator for the runtime implementation.
 */
export type OpenCodeRuntimeKind =
  | 'in-process-utility'
  | 'dedicated-utility'
  | 'forked-child'
  | 'native-subprocess';
