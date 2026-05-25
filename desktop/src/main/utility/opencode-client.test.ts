import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getBridge: vi.fn(),
  getUtilitySupervisor: vi.fn(),
}));

vi.mock('./supervisor', () => ({
  getUtilitySupervisor: mocks.getUtilitySupervisor,
}));

import { connectMcp, disconnectMcp } from './opencode-client';

beforeEach(() => {
  mocks.request.mockReset();
  mocks.getBridge.mockReset();
  mocks.getUtilitySupervisor.mockReset();
  mocks.request.mockResolvedValue({ ok: true });
  mocks.getBridge.mockReturnValue({ request: mocks.request });
  mocks.getUtilitySupervisor.mockReturnValue({ getBridge: mocks.getBridge });
});

describe('MCP operation bridge requests', () => {
  it('uses a longer bridge timeout when connecting MCP servers', async () => {
    await connectMcp(4321, 'github', '/repo');

    expect(mocks.request).toHaveBeenCalledWith(
      'opencode.connectMcp',
      { args: [4321, 'github', '/repo'] },
      { timeoutMs: 60_000 },
    );
  });

  it('uses a longer bridge timeout when disconnecting MCP servers', async () => {
    await disconnectMcp(4321, 'github', '/repo');

    expect(mocks.request).toHaveBeenCalledWith(
      'opencode.disconnectMcp',
      { args: [4321, 'github', '/repo'] },
      { timeoutMs: 60_000 },
    );
  });
});
