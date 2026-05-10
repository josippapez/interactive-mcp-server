/**
 * Barrel re-export for main-only OpenCode runtime strategies.
 *
 * Strategies are `ProcessStrategy` implementations consumed by the
 * `ManagedProcess` supervisor (see `../managed-process.ts`, Stage 2) and
 * composed by `main-host-adapter` (Stage 6). They MUST NOT be imported
 * from any backend/utility file — see `../factory.ts` for the topology
 * guard.
 */

export { ForkedUtilityStrategy } from './forked-utility';
export { NativeBinaryStrategy } from './native-binary';
