/**
 * Bridge RPC handlers for the in-process OpenCode HTTP server (Mode A).
 *
 * Registered by `entry.ts` ONLY when `RUNTIME_KIND === 'in-process-utility'`.
 * Each RPC maps 1:1 onto a public function in `./opencode-server.ts`. The
 * main-side counterpart is the `UtilityRpcAdapter` in
 * `src/main/opencode/adapters/`, behind the `server-facade.ts`.
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
