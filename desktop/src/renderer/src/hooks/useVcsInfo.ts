import { useCallback, useEffect, useState } from 'react';
import {
  seedVcsBranch,
  useConversationSelector,
} from '../store/conversation-store';
import type { VcsInfo } from '../types';

type UseVcsInfoResult = {
  vcsInfo: VcsInfo | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Hook exposing the current VCS (git) branch for the active project.
 *
 * Live updates arrive via the `vcs.updated` event on the single
 * `conversation-batch` IPC pipeline (mapped from the OpenCode v2 SDK
 * `vcs.branch.updated` event by the main-side bridge).
 *
 * On mount we perform a one-shot REST seed via `fetchVcsInfo` so the UI
 * has a branch name before the first live event arrives.
 *
 * The previous 30-second poll and the orphan `onOpenCodeVcsUpdated` IPC
 * subscription have been removed (C5 merge).
 */
export function useVcsInfo(
  enabled: boolean = true,
  baseDirectory?: string | null,
): UseVcsInfoResult {
  const [isLoading, setIsLoading] = useState(false);

  const branch = useConversationSelector((state) => state.vcsBranch);

  const vcsInfo: VcsInfo | null = branch
    ? {
        branch,
        additions: 0,
        deletions: 0,
        files: 0,
      }
    : null;

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      const result = await window.api.fetchVcsInfo?.(
        baseDirectory ?? undefined,
      );
      seedVcsBranch(result?.branch ?? null);
    } catch {
      seedVcsBranch(null);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, baseDirectory]);

  useEffect(() => {
    if (!enabled) {
      seedVcsBranch(null);
      return;
    }

    const idleCallback =
      'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 50);

    const handle = idleCallback(() => {
      void refresh();
    });

    return () => {
      if ('cancelIdleCallback' in window && typeof handle === 'number') {
        window.cancelIdleCallback(handle);
      }
    };
  }, [enabled, refresh]);

  return {
    vcsInfo,
    isLoading,
    refresh,
  };
}
