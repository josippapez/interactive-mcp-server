/**
 * Global per-channel preferences state using Jotai.
 *
 * Tracks model and reasoning selections for each channel/session,
 * persisted to localStorage for durability across page refreshes.
 *
 * Key benefits:
 * - Single source of truth for per-channel model/variant selections
 * - Accessible from any component without prop drilling
 * - Automatically persists to localStorage
 * - Integrates with default settings from app preferences
 */

import { atom, useAtomValue, useSetAtom } from 'jotai';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Per-channel model preference. */
export interface ChannelModelPreference {
  /** Provider ID (e.g., 'anthropic', 'openai'). */
  providerId: string;
  /** Model ID (e.g., 'claude-sonnet-4-20250514'). */
  modelId: string;
  /** Reasoning variant/effort level (e.g., 'low', 'medium', 'high'). */
  variant?: string;
}

/** Map of channelId (openCodeSessionId) to model preference. */
export type ChannelPreferencesMap = Map<string, ChannelModelPreference>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** localStorage key for channel preferences. */
const STORAGE_KEY = 'imcp-channel-preferences';

// -----------------------------------------------------------------------------
// Persistence Helpers
// -----------------------------------------------------------------------------

/**
 * Load channel preferences from localStorage.
 */
function loadFromStorage(): ChannelPreferencesMap {
  const result = new Map<string, ChannelModelPreference>();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return result;
    }

    const entries = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'object' || value === null) continue;

      const entry = value as Record<string, unknown>;
      if (typeof entry.providerId !== 'string') continue;
      if (typeof entry.modelId !== 'string') continue;

      const pref: ChannelModelPreference = {
        providerId: entry.providerId,
        modelId: entry.modelId,
      };
      if (typeof entry.variant === 'string') {
        pref.variant = entry.variant;
      }
      result.set(key, pref);
    }
  } catch {
    // Invalid data — return empty map
  }

  return result;
}

/**
 * Save channel preferences to localStorage.
 */
function saveToStorage(preferences: ChannelPreferencesMap): void {
  try {
    const obj: Record<string, ChannelModelPreference> = {};
    for (const [key, value] of preferences) {
      obj[key] = value;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

// -----------------------------------------------------------------------------
// Base Atoms
// -----------------------------------------------------------------------------

/**
 * Map of channel ID to model preference.
 * Initialized from localStorage on first access.
 */
export const channelPreferencesAtom =
  atom<ChannelPreferencesMap>(loadFromStorage());

// -----------------------------------------------------------------------------
// Action Atoms
// -----------------------------------------------------------------------------

/**
 * Set model preference for a specific channel.
 * Automatically persists to localStorage.
 */
export const setChannelPreferenceAtom = atom(
  null,
  (
    get,
    set,
    action: {
      channelId: string;
      preference: ChannelModelPreference;
    },
  ) => {
    const { channelId, preference } = action;
    const current = get(channelPreferencesAtom);
    const next = new Map(current);
    next.set(channelId, preference);

    if (process.env.NODE_ENV === 'development') {
      console.log('[channel-preferences] Set preference', {
        channelId,
        preference,
        timestamp: new Date().toISOString(),
      });
    }

    set(channelPreferencesAtom, next);
    saveToStorage(next);
  },
);

/**
 * Clear model preference for a specific channel (revert to default).
 * Automatically persists to localStorage.
 */
export const clearChannelPreferenceAtom = atom(
  null,
  (get, set, channelId: string) => {
    const current = get(channelPreferencesAtom);
    if (!current.has(channelId)) return;

    const next = new Map(current);
    next.delete(channelId);

    if (process.env.NODE_ENV === 'development') {
      console.log('[channel-preferences] Clear preference', {
        channelId,
        timestamp: new Date().toISOString(),
      });
    }

    set(channelPreferencesAtom, next);
    saveToStorage(next);
  },
);

/**
 * Clear all channel preferences.
 * Useful for cleanup or reset scenarios.
 */
export const clearAllChannelPreferencesAtom = atom(null, (_get, set) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[channel-preferences] Clear all preferences', {
      timestamp: new Date().toISOString(),
    });
  }

  set(channelPreferencesAtom, new Map());
  saveToStorage(new Map());
});

// -----------------------------------------------------------------------------
// Derived Atoms
// -----------------------------------------------------------------------------

/**
 * Get preference for a specific channel (creates a derived atom).
 * Returns undefined if no preference set for the channel.
 */
export function channelPreferenceAtom(channelId: string | null) {
  return atom((get) => {
    if (!channelId) return undefined;
    return get(channelPreferencesAtom).get(channelId);
  });
}

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/**
 * Hook to get all channel preferences (read-only).
 */
export function useChannelPreferences(): ChannelPreferencesMap {
  return useAtomValue(channelPreferencesAtom);
}

/**
 * Hook to get preference for a specific channel (read-only).
 */
export function useChannelPreference(
  channelId: string | null,
): ChannelModelPreference | undefined {
  const preferences = useAtomValue(channelPreferencesAtom);
  if (!channelId) return undefined;
  return preferences.get(channelId);
}

/**
 * Hook to set model preference for a channel (write-only).
 */
export function useSetChannelPreference(): (
  channelId: string,
  preference: ChannelModelPreference,
) => void {
  const setPreference = useSetAtom(setChannelPreferenceAtom);
  return (channelId: string, preference: ChannelModelPreference) =>
    setPreference({ channelId, preference });
}

/**
 * Hook to clear model preference for a channel (write-only).
 */
export function useClearChannelPreference(): (channelId: string) => void {
  return useSetAtom(clearChannelPreferenceAtom);
}

/**
 * Hook that provides full access to channel preferences.
 */
export function useChannelPreferencesStore(): {
  preferences: ChannelPreferencesMap;
  getPreference: (
    channelId: string | null,
  ) => ChannelModelPreference | undefined;
  setPreference: (
    channelId: string,
    preference: ChannelModelPreference,
  ) => void;
  clearPreference: (channelId: string) => void;
  clearAll: () => void;
} {
  const preferences = useAtomValue(channelPreferencesAtom);
  const setPreference = useSetAtom(setChannelPreferenceAtom);
  const clearPreference = useSetAtom(clearChannelPreferenceAtom);
  const clearAll = useSetAtom(clearAllChannelPreferencesAtom);

  return {
    preferences,
    getPreference: (channelId: string | null) =>
      channelId ? preferences.get(channelId) : undefined,
    setPreference: (channelId: string, preference: ChannelModelPreference) =>
      setPreference({ channelId, preference }),
    clearPreference,
    clearAll,
  };
}
