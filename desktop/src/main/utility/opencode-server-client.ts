/**
 * Main-side proxy client for the in-process OpenCode HTTP server now owned
 * by the utility process.
 *
 * Mirrors the original `opencode/server.ts` API but dispatches each call over
 * the utility bridge. Utility-local callers MUST NOT import this file; they
 * import `utility/backend/opencode-server` directly.
 */
import type { Bridge } from './bridge';
import { getUtilitySupervisor } from './supervisor';

function bridge(): Bridge {
  return getUtilitySupervisor().getBridge();
}

function call<T>(name: string, args: unknown[]): Promise<T> {
  return bridge().request<T>(name, { args });
}

export function startOpenCodeServer(port: number): Promise<void> {
  return call<void>('opencode.server.start', [port]);
}

export function stopOpenCodeServer(): Promise<void> {
  // Shutdown-tolerant: during `before-quit`, the utility supervisor's own
  // quit hook may dispose the bridge before this request completes. Swallow
  // bridge/dispose errors so callers fire-and-forget cleanly.
  try {
    return call<void>('opencode.server.stop', []).catch(() => {
      // no-op — bridge disposed or child already exited
    });
  } catch {
    // getBridge() threw (supervisor already stopped) — nothing to do
    return Promise.resolve();
  }
}

export function isOpenCodeServerRunning(): Promise<boolean> {
  return call<boolean>('opencode.server.isRunning', []);
}
