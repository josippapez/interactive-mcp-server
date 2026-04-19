/**
 * Global channel selection state using Jotai.
 *
 * This provides a single source of truth for the currently selected channel,
 * accessible from anywhere in the app without prop drilling.
 *
 * Key benefits:
 * - Consistent channel selection logic across all components
 * - Prevents race conditions between IPC events and user actions
 * - Makes the active channel easily accessible for message routing
 */

import { atom, createStore, useAtom, useAtomValue, useSetAtom } from 'jotai';

export const channelSelectionStore = createStore();

// -----------------------------------------------------------------------------
// Atoms
// -----------------------------------------------------------------------------

/**
 * The currently selected channel ID.
 * This is the `providerSessionId` for OpenCode sessions, or `connectionId` for
 * direct MCP connections.
 */
export const activeChannelIdAtom = atom<string | null>(null);

/**
 * Track whether the null selection was intentional (user action) vs automatic
 * (e.g., node deletion). When true, we don't auto-select the first node.
 */
export const intentionalNullSelectionAtom = atom<boolean>(false);

/**
 * Derived atom that combines both values for components that need both.
 */
export const channelSelectionStateAtom = atom((get) => ({
  activeId: get(activeChannelIdAtom),
  isIntentionalNull: get(intentionalNullSelectionAtom),
}));

// -----------------------------------------------------------------------------
// Write-only atom for channel selection with logging
// -----------------------------------------------------------------------------

/**
 * Action atom for selecting a channel with proper tracking.
 * Use this instead of directly setting activeChannelIdAtom to ensure
 * intentionalNullSelectionAtom is properly updated.
 */
export const selectChannelAtom = atom(
  null,
  (
    get,
    set,
    action: {
      channelId: string | null;
      source: ChannelSelectionSource;
      /** If true, this is an intentional null selection (user cleared selection) */
      intentional?: boolean;
    },
  ) => {
    const { channelId, source, intentional = false } = action;
    const previousChannelId = get(activeChannelIdAtom);
    const timestamp = new Date().toISOString();

    const logPayload = {
      previousChannelId,
      channelId,
      source,
      intentional,
      timestamp,
    };

    if (typeof window !== 'undefined' && window.api?.log) {
      window.api.log(
        'info',
        'channel-selection',
        `selectChannel ${JSON.stringify(logPayload)}`,
      );
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[channel-selection] selectChannel', logPayload);
    }

    // Track intentional null selections
    if (channelId === null) {
      set(intentionalNullSelectionAtom, intentional);
    } else {
      set(intentionalNullSelectionAtom, false);
    }

    set(activeChannelIdAtom, channelId);
  },
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Sources that can trigger channel selection.
 * Used for debugging and to apply source-specific logic if needed.
 */
export type ChannelSelectionSource =
  | 'sidebar-click' // User clicked a channel in the sidebar
  | 'prompt-received' // Auto-focus when a new prompt arrives
  | 'connection-opened' // New MCP connection was established
  | 'connection-closed' // MCP connection was closed (select another)
  | 'session-deleted' // Session was removed (select another)
  | 'keyboard-shortcut' // User navigated via keyboard
  | 'quick-switcher' // User selected via quick switcher (Cmd+K)
  | 'url-navigation' // Deep link or URL-based navigation
  | 'auto-select-first' // Auto-select first available when current disappears
  | 'initial-load' // Initial app load
  | 'hook-migration'; // Migration from useConnections hook

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/**
 * Hook to get the current active channel ID (read-only).
 */
export function useActiveChannelId(): string | null {
  return useAtomValue(activeChannelIdAtom);
}

export function getActiveChannelIdSnapshot(): string | null {
  return channelSelectionStore.get(activeChannelIdAtom);
}

/**
 * Synchronously read whether the current null selection is intentional.
 * Use this from non-React contexts (IPC handlers, side-effect callbacks)
 * that need the latest value without re-rendering.
 */
export function getIntentionalNullSelectionSnapshot(): boolean {
  return channelSelectionStore.get(intentionalNullSelectionAtom);
}

/**
 * Hook to get the full channel selection state (read-only).
 */
export function useChannelSelectionState(): {
  activeId: string | null;
  isIntentionalNull: boolean;
} {
  return useAtomValue(channelSelectionStateAtom);
}

/**
 * Hook to select a channel (write-only).
 * Returns a function that can be called to change the selected channel.
 */
export function useSelectChannel(): (
  channelId: string | null,
  source: ChannelSelectionSource,
  intentional?: boolean,
) => void {
  const selectChannel = useSetAtom(selectChannelAtom);
  return (
    channelId: string | null,
    source: ChannelSelectionSource,
    intentional = false,
  ) => selectChannel({ channelId, source, intentional });
}

/**
 * Hook that provides both read and write access to channel selection.
 * Use this when you need to both read the current selection and change it.
 */
export function useChannelSelection(): {
  activeId: string | null;
  isIntentionalNull: boolean;
  selectChannel: (
    channelId: string | null,
    source: ChannelSelectionSource,
    intentional?: boolean,
  ) => void;
} {
  const [state] = useAtom(channelSelectionStateAtom);
  const select = useSelectChannel();
  return {
    ...state,
    selectChannel: select,
  };
}
