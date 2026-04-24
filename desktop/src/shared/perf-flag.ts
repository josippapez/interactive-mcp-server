/**
 * perf-flag.ts — explicit opt-in gate for `[perf.*]` logs.
 *
 * Both main-process and renderer hot paths previously gated perf logs on
 * `NODE_ENV !== 'production'` or `import.meta.env.DEV`, which meant every
 * `dev` run paid ~60 sync disk writes/sec (main) and ~60 console.logs/sec
 * (renderer) during streaming. That turned perf instrumentation into a
 * perf regression.
 *
 * New contract: perf logs are OFF by default, including in dev. Enable
 * per-run by setting the env var (main) or the Vite build-time env
 * (renderer). See `docs/PERF-VALIDATION.md` for usage.
 *
 *   OPENCODE_PERF_LOG=1 npm run dev          # main-side
 *   VITE_OPENCODE_PERF_LOG=1 npm run dev     # renderer-side
 */

/**
 * Main-process perf gate. Reads `process.env.OPENCODE_PERF_LOG` at module
 * load. Importing from renderer is a type error: this module is main/preload.
 */
export const PERF_LOG_ENABLED: boolean =
  typeof process !== 'undefined' && process.env?.OPENCODE_PERF_LOG === '1';
