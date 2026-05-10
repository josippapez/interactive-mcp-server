/**
 * Adapter selector — Adapter Selector pattern.
 *
 * Single switch point that maps `RUNTIME_KIND` (from `../runtime-mode.ts`)
 * to the concrete `OpenCodeServerAdapter`. The facade
 * (`../server-facade.ts`) imports only this function and the type — it
 * never branches on the mode itself.
 *
 * To switch hosting modes, edit `RUNTIME_KIND` in `runtime-mode.ts`.
 * Nothing in this file changes.
 */

import { RUNTIME_KIND } from '../runtime-mode';
import { MainHostAdapter } from './main-host-adapter';
import { UtilityRpcAdapter } from './utility-rpc-adapter';
import type { OpenCodeServerAdapter } from './types';

const LOG_PREFIX = '[opencode-adapter:selector]';

let cached: OpenCodeServerAdapter | null = null;

export function selectOpenCodeAdapter(): OpenCodeServerAdapter {
  if (cached) return cached;

  switch (RUNTIME_KIND) {
    case 'in-process-utility':
      console.info(`${LOG_PREFIX} selecting UtilityRpcAdapter (Mode A)`);
      cached = new UtilityRpcAdapter();
      return cached;
    case 'dedicated-utility':
      console.info(`${LOG_PREFIX} selecting MainHostAdapter (Mode B)`);
      cached = new MainHostAdapter();
      return cached;
    case 'forked-child':
      console.info(`${LOG_PREFIX} selecting MainHostAdapter (Mode B')`);
      cached = new MainHostAdapter();
      return cached;
    case 'native-subprocess':
      console.info(`${LOG_PREFIX} selecting MainHostAdapter (Mode C)`);
      cached = new MainHostAdapter();
      return cached;
    default: {
      const exhaustive: never = RUNTIME_KIND;
      throw new Error(
        `${LOG_PREFIX} unknown RUNTIME_KIND=${String(exhaustive)}`,
      );
    }
  }
}

/**
 * Test-only helper. Resets the cached adapter so each test starts clean.
 * Not part of the public API.
 */
export function __resetAdapterForTests(): void {
  cached = null;
}
