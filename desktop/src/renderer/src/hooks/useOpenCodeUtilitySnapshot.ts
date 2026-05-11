import { useIpcQuery } from './useIpcQuery';
import type { OpenCodeUtilitySnapshot } from '../../../preload';

export function useOpenCodeUtilitySnapshot(baseDirectory?: string) {
  return useIpcQuery<OpenCodeUtilitySnapshot>(
    () => window.api.fetchOpenCodeUtilitySnapshot(baseDirectory),
    [baseDirectory],
  );
}
