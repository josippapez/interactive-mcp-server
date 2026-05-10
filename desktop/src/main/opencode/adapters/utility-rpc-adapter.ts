/**
 * Mode A adapter — `in-process-utility`.
 *
 * The OpenCode runtime lives inside the backend utility process. Main
 * drives lifecycle via the existing `opencode.server.*` Bridge RPCs and
 * reads the URL from the main-side URL subject (`../url-subject.ts`),
 * which is populated by the backend echoing its own URL via
 * `opencode.url.set` events (Stage 7 wiring).
 *
 * This adapter is a near-1:1 port of the legacy
 * `utility/opencode-server-client.ts` so behaviour is preserved while the
 * rest of the codebase moves onto the adapter contract. The legacy file
 * is removed once import callsites are swapped (Stage 6).
 *
 * Topology note: this file runs in the MAIN process. It MUST NOT be
 * imported from the backend utility — the backend talks to its own
 * runtime directly (in Mode A) without crossing the bridge. The
 * file-system layout under `src/main/opencode/adapters/` enforces that
 * implicitly; the runtime check lives in `factory.ts`.
 */

import type { Bridge } from '../../utility/bridge';
import { getUtilitySupervisor } from '../../utility/supervisor';
import type { OpenCodeServerAdapter } from './types';

const LOG_PREFIX = '[opencode-adapter:utility-rpc]';

function bridge(): Bridge {
  return getUtilitySupervisor().getBridge();
}

function call<T>(name: string, args: unknown[]): Promise<T> {
  return bridge().request<T>(name, { args });
}

export class UtilityRpcAdapter implements OpenCodeServerAdapter {
  // Mode A: runtime lives in the backend utility, but main needs cheap
  // synchronous reads for `isRunning()` and `getUrl()`. The backend
  // already returns those via dedicated RPCs; we mirror them locally on
  // each start/stop call. Cross-process URL push (Stage 7's
  // `opencode.url.set` event) keeps this in sync after backend-driven
  // restarts so we never serve stale data.
  private startedFlag = false;
  private currentUrl: string | null = null;
  private currentPort: number | null = null;

  async start(port: number): Promise<void> {
    try {
      await call<void>('opencode.server.start', [port]);
      this.startedFlag = true;
      // Backend always binds 127.0.0.1 (see `runtime/in-process.ts`).
      // Cache locally so `getUrl()` is cheap; the Stage 7 URL bridge
      // handler refreshes this on every backend-emitted change.
      this.currentUrl = `http://127.0.0.1:${port}`;
      this.currentPort = port;
    } catch (err) {
      console.error(
        `${LOG_PREFIX} start RPC failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  async stop(): Promise<void> {
    // Shutdown-tolerant: during `before-quit` the supervisor may dispose the
    // bridge before this resolves. Swallow bridge/dispose errors so callers
    // can fire-and-forget cleanly. Mirror legacy behaviour exactly.
    try {
      await call<void>('opencode.server.stop', []).catch(() => {
        // no-op — bridge disposed or child already exited
      });
    } catch {
      // getBridge() threw (supervisor already stopped) — nothing to do
    } finally {
      this.startedFlag = false;
      this.currentUrl = null;
      this.currentPort = null;
    }
  }

  isRunning(): boolean {
    return this.startedFlag;
  }

  getUrl(): string | null {
    return this.currentUrl;
  }

  getResolvedPort(): number | null {
    // Mode A does not probe — port passed to start() is used verbatim.
    return this.currentPort;
  }
}
