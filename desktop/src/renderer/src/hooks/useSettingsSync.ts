/**
 * Settings synchronization hook.
 *
 * This file now re-exports from the Jotai-based settings store for backwards
 * compatibility. The polling-based implementation has been replaced with a
 * more efficient Jotai atom-based approach.
 *
 * @see src/renderer/src/store/settings.ts for the implementation
 */

// Re-export the type and hook from the store for backwards compatibility
export { type SyncedSettings, useSettingsSync } from '../store/settings';
