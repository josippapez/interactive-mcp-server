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
 *
 * # Authentication (Mode C)
 *
 * When the OpenCode binary is launched with `OPENCODE_SERVER_PASSWORD` set
 * (Mode C, see `runtime/strategies/native-binary.ts`), every HTTP request
 * must carry an `Authorization: Basic <base64("opencode:<pwd>")>` header.
 * The password is published into the password-subject by the host adapter
 * BEFORE the URL becomes visible, so by the time consumers ask for a
 * client the credential is already there.
 *
 * The factory injects an interceptor that reads the password lazily on
 * each request — no need to invalidate the cache when the password
 * changes (which only happens on full server restart, when consumers
 * already re-resolve the port via the URL subject anyway). For Mode A
 * (in-process server, no password set) the header is omitted entirely
 * and the binary serves unauthenticated.
 *
 * Cache key still uses just `(port, directory)` because a given (port,
 * directory) pair maps to exactly one running runtime — switching to a
 * different password without changing the port would mean a new server
 * instance, which would change the port too in our supervisor. Belt and
 * braces: the interceptor is dynamic, not bound at factory-call time.
 */

import {
  createOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2/client';

import { getOpenCodePassword } from './opencode-password-source';

function buildClient(
  port: number,
  directory?: string,
  experimentalWorkspaceId?: string,
): OpencodeClient {
  const client = createOpencodeClient({
    baseUrl: `http://localhost:${port}`,
    directory,
    experimental_workspaceID: experimentalWorkspaceId,
  });

  // SDK exposes its underlying http client via `getConfig`-style helpers,
  // but the public type only guarantees the high-level surface. The
  // generated client class always has `.client.interceptors` (see the
  // upstream SDK runtime), so we narrow via a structural cast and attach
  // a request interceptor that reads the password lazily.
  const lowLevel = (
    client as unknown as {
      client?: {
        interceptors?: {
          request?: {
            use(fn: (req: Request) => Request | Promise<Request>): unknown;
          };
        };
      };
    }
  ).client;

  if (lowLevel?.interceptors?.request) {
    lowLevel.interceptors.request.use((req) => {
      // Don't overwrite a pre-set Authorization header (e.g. from
      // upstream SSE consumer that already injected one).
      if (req.headers.has('Authorization')) return req;
      const pwd = getOpenCodePassword();
      if (!pwd) return req;
      // Username is always `opencode` per the upstream SDK helper.
      const credential = `opencode:${pwd}`;
      // Buffer is available in main + utility (Node) and in renderer if
      // ever bundled; fall back to btoa() in pure-browser contexts.
      const encoded =
        typeof Buffer !== 'undefined'
          ? Buffer.from(credential, 'utf8').toString('base64')
          : btoa(credential);
      const next = new Request(req, {
        headers: new Headers(req.headers),
      });
      next.headers.set('Authorization', `Basic ${encoded}`);
      return next;
    });
  }

  return client;
}

let _factory: (
  port: number,
  directory?: string,
  experimentalWorkspaceId?: string,
) => OpencodeClient = buildClient;

const _cache = new Map<string, OpencodeClient>();

function cacheKey(
  port: number,
  directory?: string,
  experimentalWorkspaceId?: string,
): string {
  return `${port}::${directory ?? ''}::${experimentalWorkspaceId ?? ''}`;
}

/** Test seam — replace the factory and flush the cache. */
export function _setClientFactory(
  factory: (
    port: number,
    directory?: string,
    experimentalWorkspaceId?: string,
  ) => OpencodeClient,
): void {
  _factory = factory;
  _cache.clear();
}

/** Test seam — restore the default factory. */
export function _resetClientFactory(): void {
  _factory = buildClient;
  _cache.clear();
}

/** Get (or lazily create) a cached OpencodeClient for `(port, directory)`. */
export function getClient(
  port: number,
  directory?: string,
  experimentalWorkspaceId?: string,
): OpencodeClient {
  const key = cacheKey(port, directory, experimentalWorkspaceId);
  let client = _cache.get(key);
  if (!client) {
    client = _factory(port, directory, experimentalWorkspaceId);
    _cache.set(key, client);
  }
  return client;
}
