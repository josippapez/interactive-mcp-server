/**
 * Shared OpenCode SDK client factory + cache.
 *
 * Originally lived at `desktop/src/main/opencode/sdk-client.ts`. The Phase 2
 * backend extraction moved the SSE/event-stream subsystem into the Electron
 * utility process; the utility's copy under `main/utility/backend/sdk-client.ts`
 * still owns the *active* cache used by the SSE loop, permission replies, and
 * event-bridge calls inside the utility.
 *
 * Main-process code (HTTP probes, provider/MCP helpers, injection) still needs
 * an identical factory — it cannot reach across the process boundary for every
 * tiny REST call. This module provides a main-side cache with the same surface
 * so consumers don't have to change how they call `getClient(port, dir?)`.
 *
 * The two caches are intentionally independent: they live in different V8
 * isolates and hold different `OpencodeClient` instances. That's fine — the
 * underlying `createOpencodeClient` is a lightweight fetch-based wrapper with
 * no cross-process state.
 */

import {
  createOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2/client';

let _factory: (port: number, directory?: string) => OpencodeClient = (
  port,
  directory,
) =>
  createOpencodeClient({
    baseUrl: `http://localhost:${port}`,
    directory,
  });

const _cache = new Map<string, OpencodeClient>();

function cacheKey(port: number, directory?: string): string {
  return `${port}::${directory ?? ''}`;
}

/** Test seam — replace the factory and flush the cache. */
export function _setClientFactory(
  factory: (port: number, directory?: string) => OpencodeClient,
): void {
  _factory = factory;
  _cache.clear();
}

/** Test seam — restore the default factory. */
export function _resetClientFactory(): void {
  _factory = (port, directory) =>
    createOpencodeClient({
      baseUrl: `http://localhost:${port}`,
      directory,
    });
  _cache.clear();
}

/** Get (or lazily create) a cached OpencodeClient for `(port, directory)`. */
export function getClient(port: number, directory?: string): OpencodeClient {
  const key = cacheKey(port, directory);
  let client = _cache.get(key);
  if (!client) {
    client = _factory(port, directory);
    _cache.set(key, client);
  }
  return client;
}
