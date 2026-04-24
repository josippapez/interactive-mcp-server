/**
 * renderer perf-flag — explicit opt-in gate for `[perf.*]` logs in renderer.
 *
 * Set `VITE_OPENCODE_PERF_LOG=1` in the environment (or `.env.development.local`)
 * to enable. OFF by default, including in `dev` mode.
 *
 * Kept separate from the main-process flag so the renderer bundle doesn't
 * try to read `process.env` at runtime.
 */

export const PERF_LOG_ENABLED: boolean =
  import.meta.env?.VITE_OPENCODE_PERF_LOG === '1';
