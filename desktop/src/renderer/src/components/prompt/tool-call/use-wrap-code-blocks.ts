import { useCallback } from 'react';
import { useSettings, useUpdateSettings } from '../../../store';

/**
 * Shared hook reading/writing the persisted `wrapCodeBlocks` setting.
 *
 * Used by `WrapToggleCodeBlock` (plain code/output blocks) and the
 * side-by-side diff renderers (`DiffView`, `ApplyPatchToolCard`) so
 * toggling wrap on any of them flips a single global preference that
 * survives across sessions.
 */
export function useWrapCodeBlocks(): {
  wrapLines: boolean;
  toggleWrap: () => Promise<void>;
} {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const wrapLines = settings.wrapCodeBlocks;

  const toggleWrap = useCallback(async () => {
    const next = !wrapLines;
    // Optimistic update for immediate UI feedback across all consumers.
    updateSettings({ wrapCodeBlocks: next });
    // Persist using a fresh read of main-process AppSettings to avoid
    // clobbering fields the renderer doesn't hold in SyncedSettings.
    try {
      const current = await window.api.getSettings();
      await window.api.saveSettings({ ...current, wrapCodeBlocks: next });
    } catch {
      // Non-fatal: optimistic state still applied this session.
    }
  }, [wrapLines, updateSettings]);

  return { wrapLines, toggleWrap };
}
