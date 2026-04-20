/**
 * Global test setup for renderer-side React component tests.
 *
 * Loaded via vitest.config.ts `setupFiles`. Runs once per test file.
 *
 * Responsibilities:
 *   1. Register jest-dom matchers (toBeInTheDocument, etc.).
 *   2. Clean up rendered React trees between tests.
 *   3. Provide a default `window.api` stub so components that call
 *      `window.api.*` during render don't crash.
 *
 * The stub is implemented as a `Proxy` so every property access returns a
 * `vi.fn()` with a sensible default return value inferred from the method
 * name. Individual tests can still override specific methods with
 * `vi.spyOn(window.api, 'getSettings').mockResolvedValue(...)`.
 *
 * Conventions (applied to both direct access AND method calls):
 *   - `onXxx`        → listener registrar; returns a cleanup fn (`vi.fn()`).
 *   - `list*`        → returns `Promise.resolve([])`.
 *   - `get*`, `fetch*`, `read*`, `detect*`, `resolve*`, `reResolve*`,
 *     `search*`                → returns `Promise.resolve(null)`.
 *   - anything else (set/save/add/remove/upsert/delete/inject/etc.)
 *                     → returns `Promise.resolve({ ok: true })`.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// ──────────────────────────────────────────────────────────────────────────
// window.api stub
// ──────────────────────────────────────────────────────────────────────────

type ApiMethod = (...args: unknown[]) => unknown;

function defaultReturnFor(propName: string): unknown {
  if (propName.startsWith('on')) {
    // Listener registrar — return a cleanup function.
    return vi.fn();
  }
  if (propName.startsWith('list')) {
    return Promise.resolve([]);
  }
  if (
    propName.startsWith('get') ||
    propName.startsWith('fetch') ||
    propName.startsWith('read') ||
    propName.startsWith('detect') ||
    propName.startsWith('resolve') ||
    propName.startsWith('reResolve') ||
    propName.startsWith('search') ||
    propName.startsWith('is') ||
    propName.startsWith('check') ||
    propName.startsWith('select') ||
    propName.startsWith('open')
  ) {
    return Promise.resolve(null);
  }
  // Action methods — send/save/set/add/remove/upsert/delete/inject/etc.
  return Promise.resolve({ ok: true });
}

/**
 * Build an empty api object that lazily materializes `vi.fn()`s on access so
 * the same `vi.fn` instance is returned on every access of the same
 * property (important for tests that want to assert call counts).
 */
function createApiStub(): Record<string, ApiMethod> {
  const cache = new Map<string, ApiMethod>();
  return new Proxy({} as Record<string, ApiMethod>, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (!cache.has(prop)) {
        const fn = vi.fn(() => defaultReturnFor(prop));
        cache.set(prop, fn as unknown as ApiMethod);
      }
      return cache.get(prop);
    },
    has() {
      return true;
    },
  });
}

vi.stubGlobal('api', createApiStub());

// Also expose on window for code paths that guard with `typeof window !== 'undefined'`.
if (typeof window !== 'undefined') {
  (window as unknown as { api: unknown }).api = createApiStub();
}
