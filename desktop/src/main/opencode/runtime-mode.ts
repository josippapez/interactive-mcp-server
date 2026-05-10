/**
 * Single source of truth for which OpenCode runtime mode is active.
 *
 * Both the main process and the backend utility need to agree:
 *   - In Mode A (`in-process-utility`), the BACKEND UTILITY hosts
 *     `Server.listen()`. Main drives lifecycle remotely via the existing
 *     `opencode.server.*` bridge RPCs.
 *   - In Mode B (`dedicated-utility`), the MAIN PROCESS forks a sibling
 *     `opencode-host` utility and owns its lifecycle directly. The backend
 *     no longer hosts the server — it queries main for the URL.
 *   - In Mode C (`native-subprocess`), same ownership as Mode B but main
 *     spawns a per-platform binary instead of forking a JS bundle.
 *
 * Importing this constant from both sides guarantees they never disagree:
 * if main thinks the backend is hosting but the backend doesn't, you get
 * silent ECONNREFUSED. Put both readers behind the same import.
 *
 * To switch modes, change ONLY this file. Rebuild and restart.
 */

import type { OpenCodeRuntimeKind } from './runtime/types';

export const RUNTIME_KIND: OpenCodeRuntimeKind = 'native-subprocess';

/**
 * Whether the active mode is hosted in the main process (Mode B/B'/C) rather
 * than inside the backend utility (Mode A).
 */
export function isMainHostedRuntime(
  kind: OpenCodeRuntimeKind = RUNTIME_KIND,
): boolean {
  return (
    kind === 'dedicated-utility' ||
    kind === 'forked-child' ||
    kind === 'native-subprocess'
  );
}
