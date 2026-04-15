export function createReconcileScheduler(
  clearTimer: () => void,
  setTimer: (timer: ReturnType<typeof setTimeout> | null) => void,
  fetchMessages: () => Promise<void>,
) {
  return (delayMs: number, flush: () => void) => {
    clearTimer();
    const timer = setTimeout(() => {
      setTimer(null);
      flush();
      void fetchMessages();
    }, delayMs);
    setTimer(timer);
  };
}
