/**
 * Bridge RPC handlers for the in-process OpenCode HTTP server.
 *
 * Registered once by `entry.ts`. One RPC per public function in
 * `opencode-server.ts` — main-side proxies live in
 * `utility/opencode-server-client.ts`.
 */

import type { Bridge } from '../bridge';
import {
  startOpenCodeServer,
  stopOpenCodeServer,
  isOpenCodeServerRunning,
} from './opencode-server';

interface ArgsEnvelope {
  args?: unknown[];
}

function argsOf(payload: unknown): unknown[] {
  return (payload as ArgsEnvelope | undefined)?.args ?? [];
}

export function registerOpencodeServerRpcHandlers(bridge: Bridge): void {
  bridge.handle('opencode.server.start', async (payload) => {
    const [port] = argsOf(payload) as [number];
    await startOpenCodeServer(port);
    return { ok: true };
  });

  bridge.handle('opencode.server.stop', async () => {
    await stopOpenCodeServer();
    return { ok: true };
  });

  bridge.handle('opencode.server.isRunning', () => {
    return isOpenCodeServerRunning();
  });
}
