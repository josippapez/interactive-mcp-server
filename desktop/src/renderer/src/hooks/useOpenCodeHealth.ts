/**
 * Re-export OpenCode health hook and utilities from the Jotai store.
 *
 * This file exists for backwards compatibility. All state management
 * has been migrated to @renderer/store/opencode-health.ts
 */
export {
  // Types
  type OpenCodeHealthStatus,
  // Main hook (backwards compatible)
  useOpenCodeHealth,
  // Individual hooks for granular subscriptions
  useHealthStatus,
  useHealthChecking,
  useHealthState,
  useCheckHealth,
  useSetHealthEnabled,
  // Atoms (for advanced use cases)
  healthStatusAtom,
  healthCheckingAtom,
  healthEnabledAtom,
  lastHealthCheckAtom,
  healthStateAtom,
  checkHealthAtom,
  setHealthEnabledAtom,
} from '../store/opencode-health';
