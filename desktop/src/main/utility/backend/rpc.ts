/**
 * Backend-side bridge accessor.
 *
 * The utility process has a single `Bridge` instance (built in `entry.ts`
 * from the transferred MessagePort). Modules under this directory reach
 * main-process services — DB lookups, session-tree invalidations, the
 * renderer `to-renderer` forwarder, etc — by grabbing the bridge via
 * `getMainRpc()` and issuing `request(...)` / `emit(...)` calls.
 *
 * `setMainRpc` is called once during bootstrap with the Bridge; any call
 * before that throws. This keeps the wiring explicit: modules declare
 * their dependency on the bridge without having to import from `entry.ts`
 * (which would create a circular dependency).
 */

import type { Bridge } from '../bridge';

let _bridge: Bridge | null = null;

/** Called by `entry.ts` once the Bridge is ready. */
export function setMainRpc(bridge: Bridge): void {
  _bridge = bridge;
}

/** Clear the stored bridge reference (used by tests). */
export function clearMainRpc(): void {
  _bridge = null;
}

/** Returns the installed Bridge. Throws if `setMainRpc` wasn't called. */
export function getMainRpc(): Bridge {
  if (!_bridge) {
    throw new Error(
      '[utility/backend/rpc] bridge not installed — setMainRpc() must run during bootstrap',
    );
  }
  return _bridge;
}

/** Non-throwing variant for best-effort fire-and-forget emits. */
export function getMainRpcOrNull(): Bridge | null {
  return _bridge;
}
