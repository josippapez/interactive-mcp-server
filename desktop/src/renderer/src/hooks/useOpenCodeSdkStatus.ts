import { useIpcQuery } from './useIpcQuery';
import type { OpenCodeSdkStatus } from '../../../preload';

export function useOpenCodeSdkStatus(baseDirectory?: string) {
  return useIpcQuery<OpenCodeSdkStatus>(
    () => window.api.fetchOpenCodeSdkStatus(baseDirectory),
    [baseDirectory],
  );
}
