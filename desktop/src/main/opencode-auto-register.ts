import {
  registerMcpWithOpenCode,
  type McpRegistrationResult,
} from './opencode-mcp-register';

export type RegisterWithOpenCode = (options: {
  appPort: number;
  openCodePort: number;
}) => Promise<McpRegistrationResult>;

export interface AutoRegisterOptions {
  getAppPort: () => number;
  getOpenCodePort: () => number;
  intervalMs?: number;
  shouldAttempt?: () => boolean | Promise<boolean>;
}

const DEFAULT_INTERVAL_MS = 15_000;

export function startAutoRegisterWithOpenCode(
  options: AutoRegisterOptions,
  register: RegisterWithOpenCode = registerMcpWithOpenCode,
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const shouldAttempt = options.shouldAttempt ?? (() => true);
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      scheduleNext();
      return;
    }

    const canAttempt = await shouldAttempt();
    if (!canAttempt) {
      scheduleNext();
      return;
    }

    running = true;
    try {
      const appPort = options.getAppPort();
      const openCodePort = options.getOpenCodePort();
      await register({ appPort, openCodePort });
    } finally {
      running = false;
      scheduleNext();
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
