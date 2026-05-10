/**
 * Bridge RPC contract between the main utility process and the dedicated
 * `opencode-host` utility process.
 *
 * Mode B (dedicated-utility) runs OpenCode's `Server.listen()` in its own
 * `utilityProcess.fork()` child. This file pins the wire-level contract so
 * the runtime client (`runtime-dedicated-utility.ts`) and the host entry
 * (`opencode-host-entry.ts`) stay in sync.
 *
 * Keeping the surface tiny is intentional — Mode C (native subprocess) can
 * later replace the bridge transport with HTTP without changing the
 * lifecycle semantics, because every RPC name maps cleanly to a real-world
 * server-management verb.
 */

/** RPC: boot the embedded OpenCode server on `port`. */
export const RPC_START = 'opencode-host.start';
/** RPC: stop the embedded OpenCode server. */
export const RPC_STOP = 'opencode-host.stop';
/** RPC: report whether a listener is live + its URL. */
export const RPC_STATUS = 'opencode-host.status';

/** Init envelope main → host (postMessage with port + this `data`). */
export interface OpencodeHostInitMessage {
  kind: 'init';
  /** Platform log dir (= `app.getPath('logs')`). */
  logsDir?: string;
  /** Electron userData dir (= `app.getPath('userData')`). Required for XDG_STATE_HOME pin. */
  userDataPath: string;
}

export interface StartArgs {
  port: number;
}

export interface StartResult {
  ok: true;
  url: string;
}

export interface StopResult {
  ok: true;
}

export interface StatusResult {
  running: boolean;
  url: string | null;
}
