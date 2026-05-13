import { describe, expect, it, vi } from 'vitest';
import { registerMcpAfterOpenCodeHealthy } from './mcp-startup-registration';

describe('registerMcpAfterOpenCodeHealthy', () => {
  it('waits for OpenCode health before registering MCP', async () => {
    const calls: string[] = [];
    const result = await registerMcpAfterOpenCodeHealthy({
      waitForHealthy: async () => {
        calls.push('health');
        return true;
      },
      register: async () => {
        calls.push('register');
        return { status: 'registered' };
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(calls).toEqual(['health', 'register']);
    expect(result).toEqual({ status: 'registered' });
  });

  it('does not register when OpenCode never becomes healthy', async () => {
    const register = vi.fn(async () => ({ status: 'registered' }));
    const result = await registerMcpAfterOpenCodeHealthy({
      waitForHealthy: async () => false,
      register,
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(register).not.toHaveBeenCalled();
    expect(result.status).toBe('unreachable');
  });
});
