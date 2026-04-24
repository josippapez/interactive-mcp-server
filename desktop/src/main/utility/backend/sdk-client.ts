/**
 * Utility-process re-export of the shared OpenCode SDK client cache.
 *
 * Lives here because this module was originally at
 * `desktop/src/main/opencode/sdk-client.ts` — the Phase 2 extraction moved
 * it with the rest of the SSE subsystem. The canonical implementation now
 * lives under `desktop/src/shared/opencode-sdk-cache.ts` so the main-side
 * shim at `desktop/src/main/opencode/sdk-client.ts` can share the same
 * factory interface.
 *
 * NOTE: each process has its own client cache (this is a V8-per-process
 * singleton). That's fine — the cache holds lightweight fetch-based
 * clients with no cross-process state.
 */

export {
  getClient,
  _setClientFactory,
  _resetClientFactory,
} from '../../../shared/opencode-sdk-cache';
