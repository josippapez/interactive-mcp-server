/**
 * Centralized factory for `OpenCodeRuntime` instances.
 *
 * This is the ONLY place `OpenCodeRuntimeKind` branches into a concrete
 * runtime. All callers that need a runtime go through here so that mode
 * selection is impossible to scatter across the codebase.
 *
 * Topology rules
 * --------------
 *   - Mode A (`in-process-utility`): the runtime is dynamic-imported and
 *     instantiated here. It runs inside whichever process calls the
 *     factory (typically the backend utility process today).
 *
 *   - Mode B (`dedicated-utility`) and Mode C (`native-subprocess`): the
 *     runtime owns a child process. It MUST be created and held by the
 *     main process (Electron's `utilityProcess.fork` and
 *     `child_process.spawn` are main-only or require main-side
 *     coordination). For these modes the factory itself does NOT
 *     instantiate the strategy — that wiring lives in
 *     `src/main/opencode/adapters/main-host-adapter.ts` (Stage 6 of the
 *     refactor; see `desktop/docs/MODE-B-TOPOLOGY-REFACTOR-PLAN.md`).
 *
 * Topology guard
 * --------------
 * Electron sets `process.type === 'browser'` in the main process and
 * `'utility'` in utility processes. We refuse Mode B/C requests from any
 * non-main caller so a backend file accidentally importing this factory
 * cannot silently spawn a child it isn't allowed to own.
 *
 * This guard is defense-in-depth — the file-system layout under
 * `src/main/opencode/runtime/strategies/` already signals "main only", but
 * a runtime check makes the failure loud and fast.
 */

import type { OpenCodeRuntime, OpenCodeRuntimeKind } from './types';

/**
 * Whether the current process is Electron's main (browser) process.
 *
 * `process.type` is set by Electron:
 *   - `'browser'` in the main process
 *   - `'utility'` in `utilityProcess` children
 *   - `'worker'` in `Worker` threads
 *   - `undefined` in plain Node (e.g. tests)
 *
 * Plain-Node callers (tests, scripts) are treated as "not main" — Mode B/C
 * can only run inside Electron's main, so they are correctly rejected.
 */
function isMainProcess(): boolean {
  const type = (process as { type?: string }).type;
  return type === 'browser';
}

/**
 * Build an `OpenCodeRuntime` for the requested kind.
 *
 * Mode A returns a real runtime. Mode B/C deliberately throw with a
 * descriptive error pointing the caller at `main-host-adapter`, where
 * those modes are composed via the supervisor + strategy pattern.
 */
export async function createOpenCodeRuntime(
  kind: OpenCodeRuntimeKind,
): Promise<OpenCodeRuntime> {
  switch (kind) {
    case 'in-process-utility': {
      const { InProcessOpenCodeRuntime } = await import('./in-process');
      return new InProcessOpenCodeRuntime();
    }
    case 'dedicated-utility':
    case 'forked-child':
    case 'native-subprocess': {
      const where = isMainProcess()
        ? 'main process'
        : `non-main process (process.type=${String((process as { type?: string }).type)})`;
      throw new Error(
        `[opencode-runtime-factory] Mode '${kind}' must be created from the main ` +
          `process and composed via main-host-adapter (see ` +
          `desktop/docs/MODE-B-TOPOLOGY-REFACTOR-PLAN.md §Stage 6). ` +
          `Direct creation from this factory is not wired yet — do not invoke ` +
          `until that stage lands. Caller is in: ${where}.`,
      );
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(
        `[opencode-runtime-factory] Unknown OpenCodeRuntime kind: ${String(exhaustive)}`,
      );
    }
  }
}
