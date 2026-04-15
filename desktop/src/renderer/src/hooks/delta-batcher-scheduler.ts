import { Throttler } from '@tanstack/pacer';

export interface DeltaBatcherScheduler {
  schedule: () => void;
  cancel: () => void;
  flush: () => void;
}

export function createDeltaBatcherScheduler(
  flush: () => void,
  paceMs: number,
): DeltaBatcherScheduler {
  if (paceMs <= 0) {
    return {
      schedule: flush,
      cancel: () => undefined,
      flush,
    };
  }

  const throttler = new Throttler(flush, {
    wait: paceMs,
    leading: true,
    trailing: true,
  });

  return {
    schedule: () => throttler.maybeExecute(),
    cancel: () => throttler.cancel(),
    flush: () => throttler.flush(),
  };
}
