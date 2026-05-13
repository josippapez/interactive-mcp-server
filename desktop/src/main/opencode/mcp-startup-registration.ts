export interface StartupMcpRegistrationOptions {
  waitForHealthy: () => Promise<boolean>;
  register: () => Promise<{ status: string; error?: string }>;
  log: {
    warn: (message: string) => void;
    info: (message: string) => void;
  };
}

export async function registerMcpAfterOpenCodeHealthy({
  waitForHealthy,
  register,
  log,
}: StartupMcpRegistrationOptions): Promise<{
  status: string;
  error?: string;
}> {
  const healthy = await waitForHealthy();
  if (!healthy) {
    const result = { status: 'unreachable', error: 'OpenCode not healthy' };
    log.warn('[startup-register] OpenCode not healthy; skipped MCP register');
    return result;
  }

  const result = await register();
  const errorSuffix = result.error ? ` error=${result.error}` : '';
  log.info(`[startup-register] status=${result.status}${errorSuffix}`);
  return result;
}
