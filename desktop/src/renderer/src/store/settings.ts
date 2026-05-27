/**
 * Global settings state using Jotai.
 *
 * This provides a single source of truth for synced app settings,
 * replacing the polling-based useSettingsSync hook.
 *
 * Key benefits:
 * - No polling overhead — settings are fetched once and updated on demand
 * - Shared state across all components without prop drilling
 * - IPC listener support for immediate updates when settings change
 * - Manual refresh available for explicit re-fetch
 */

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { isChatTextSize } from '../components/prompt/chat-text-size';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Subset of settings that components need to react to changes.
 * Add more fields here as needed.
 */
export type SyncedSettings = {
  compactMode: boolean;
  defaultNoReply: boolean;
  defaultExpandAllTools: boolean;
  defaultShowThinking: boolean;
  toolAutoExpandExclusions: string[];
  agentBackend: string;
  autoRestoreSessions: boolean;
  hideSystemReminders: boolean;
  hideDocInjections: boolean;
  chatTextSize: 'sm' | 'md' | 'lg';
  /** Default model ID for new sessions. */
  defaultModelId: string;
  /** Default provider ID for the default model. */
  defaultProviderId: string;
  /** Default reasoning variant/effort level. */
  defaultReasoningVariant: string;
  wrapCodeBlocks: boolean;
};

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_SETTINGS: SyncedSettings = {
  compactMode: false,
  defaultNoReply: true,
  defaultExpandAllTools: false,
  defaultShowThinking: false,
  toolAutoExpandExclusions: [],
  agentBackend: '',
  autoRestoreSessions: false,
  hideSystemReminders: false,
  hideDocInjections: false,
  chatTextSize: 'md',
  defaultModelId: '',
  defaultProviderId: '',
  defaultReasoningVariant: '',
  wrapCodeBlocks: true,
};

// -----------------------------------------------------------------------------
// Base Atoms
// -----------------------------------------------------------------------------

/**
 * The current synced settings state.
 */
export const settingsAtom = atom<SyncedSettings>(DEFAULT_SETTINGS);

/**
 * Loading state for settings fetch operations.
 */
export const settingsLoadingAtom = atom<boolean>(true);

/**
 * Error state for settings fetch operations (if any).
 */
export const settingsErrorAtom = atom<string | null>(null);

// -----------------------------------------------------------------------------
// Derived Atoms
// -----------------------------------------------------------------------------

/**
 * Derived atom that combines settings with loading state.
 */
export const settingsStateAtom = atom((get) => ({
  settings: get(settingsAtom),
  isLoading: get(settingsLoadingAtom),
  error: get(settingsErrorAtom),
}));

// -----------------------------------------------------------------------------
// Action Atoms
// -----------------------------------------------------------------------------

/**
 * Action atom for fetching settings from the main process.
 * Updates both settings and loading state atomically.
 */
export const fetchSettingsAtom = atom(null, async (_get, set) => {
  set(settingsLoadingAtom, true);
  set(settingsErrorAtom, null);

  try {
    const s = await window.api.getSettings();

    const syncedSettings: SyncedSettings = {
      compactMode: s.compactMode ?? false,
      defaultNoReply: s.defaultNoReply ?? true,
      defaultExpandAllTools: s.defaultExpandAllTools ?? false,
      defaultShowThinking: s.defaultShowThinking ?? false,
      toolAutoExpandExclusions: s.toolAutoExpandExclusions ?? [],
      agentBackend: s.agentBackend ?? '',
      autoRestoreSessions: s.autoRestoreSessions ?? false,
      hideSystemReminders: s.hideSystemReminders ?? false,
      hideDocInjections: s.hideDocInjections ?? false,
      chatTextSize: isChatTextSize(s.chatTextSize ?? '')
        ? s.chatTextSize
        : 'md',
      defaultModelId: s.defaultModelId ?? '',
      defaultProviderId: s.defaultProviderId ?? '',
      defaultReasoningVariant: s.defaultReasoningVariant ?? '',
      wrapCodeBlocks: s.wrapCodeBlocks ?? true,
    };

    set(settingsAtom, syncedSettings);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Failed to fetch settings';
    set(settingsErrorAtom, errorMessage);
    window.api.log?.(
      'warn',
      'settings-store',
      `Failed to fetch settings: ${errorMessage}`,
    );
  } finally {
    set(settingsLoadingAtom, false);
  }
});

/**
 * Action atom for updating specific settings fields.
 * Useful for optimistic updates before saving to main process.
 */
export const updateSettingsAtom = atom(
  null,
  (_get, set, updates: Partial<SyncedSettings>) => {
    set(settingsAtom, (prev) => ({ ...prev, ...updates }));
  },
);

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/**
 * Hook to get the current settings (read-only).
 */
export function useSettings(): SyncedSettings {
  return useAtomValue(settingsAtom);
}

/**
 * Hook to get the loading state (read-only).
 */
export function useSettingsLoading(): boolean {
  return useAtomValue(settingsLoadingAtom);
}

/**
 * Hook to get the full settings state including loading/error (read-only).
 */
export function useSettingsState(): {
  settings: SyncedSettings;
  isLoading: boolean;
  error: string | null;
} {
  return useAtomValue(settingsStateAtom);
}

/**
 * Hook to fetch/refresh settings (write-only).
 * Returns a function that can be called to refresh settings.
 */
export function useFetchSettings(): () => Promise<void> {
  const fetchSettings = useSetAtom(fetchSettingsAtom);
  return fetchSettings;
}

/**
 * Hook to update settings locally (write-only).
 * Returns a function that can be called to update settings optimistically.
 */
export function useUpdateSettings(): (
  updates: Partial<SyncedSettings>,
) => void {
  return useSetAtom(updateSettingsAtom);
}

/**
 * Hook that provides backwards-compatible API matching the old useSettingsSync hook.
 *
 * Features:
 * - Fetches settings on mount
 * - Listens for IPC settings-changed events (when main process emits them)
 * - Provides manual refresh function
 *
 * @returns Same shape as the original useSettingsSync hook
 */
export function useSettingsSync(): {
  settings: SyncedSettings;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const [settings] = useAtom(settingsAtom);
  const [isLoading] = useAtom(settingsLoadingAtom);
  const fetchSettings = useSetAtom(fetchSettingsAtom);
  const mountedRef = useRef(true);

  // Fetch settings on mount
  useEffect(() => {
    mountedRef.current = true;
    void fetchSettings();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchSettings]);

  // Listen for settings-changed IPC event from main process
  useEffect(() => {
    const cleanup = window.api.onSettingsChanged(() => {
      if (mountedRef.current) {
        void fetchSettings();
      }
    });

    return cleanup;
  }, [fetchSettings]);

  return {
    settings,
    isLoading,
    refresh: fetchSettings,
  };
}

/**
 * Hook that provides full read/write access to settings.
 * Use this when you need both reading and updating settings.
 */
export function useSettingsStore(): {
  settings: SyncedSettings;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (updates: Partial<SyncedSettings>) => void;
} {
  const state = useSettingsState();
  const refresh = useFetchSettings();
  const update = useUpdateSettings();

  return {
    ...state,
    refresh,
    update,
  };
}
