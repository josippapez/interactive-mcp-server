import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerConnectionTool } from './register-connection';

vi.mock('../database', () => ({
  upsertRegisteredConnection: vi.fn(),
  createSessionChannel: vi.fn(),
  isOpenCodeSessionClaimed: vi.fn().mockReturnValue(false),
  getConnectionClaimingSession: vi.fn().mockReturnValue(null),
  clearConnectionOpenCodeSession: vi.fn(),
  listSkillsAndInstructions: vi.fn().mockReturnValue([]),
}));

vi.mock('../opencode-session', () => ({
  autoDetectOpenCodeSession: vi.fn(),
}));

vi.mock('../session-tree-manager', () => ({
  triggerSessionTreeUpdate: vi.fn(),
}));

vi.mock('../doc-context-injector', () => ({
  initDocContext: vi.fn(),
}));

import { upsertRegisteredConnection, createSessionChannel } from '../database';
import { autoDetectOpenCodeSession } from '../opencode-session';

type RegisterConnectionInput = {
  channelName: string;
  projectName: string;
  baseDirectory?: string;
  openCodeSessionId?: string;
};

type RegisterConnectionHandler = (
  input: RegisterConnectionInput,
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

function getToolHandler(connectionId = 'conn-test'): RegisterConnectionHandler {
  const server = {
    registerTool: vi.fn(),
  } as unknown as McpServer;

  registerConnectionTool(
    server,
    () => null,
    connectionId,
    () => 4096,
    () => true,
    () => 'opencode',
  );

  const toolCall = (server.registerTool as Mock).mock.calls[0];
  return toolCall[2] as RegisterConnectionHandler;
}

describe('register_connection tool', () => {
  const mockUpsert = upsertRegisteredConnection as Mock;
  const mockCreateSessionChannel = createSessionChannel as Mock;
  const mockAutoDetect = autoDetectOpenCodeSession as Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    mockUpsert.mockReset();
    mockCreateSessionChannel.mockReset();
    mockAutoDetect.mockReset();
    mockUpsert.mockReturnValue('/tmp/imcp-agent-test.json');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out when registration takes longer than 15 seconds', async () => {
    mockAutoDetect.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(null), 20_000);
        }),
    );

    const handler = getToolHandler();
    const run = handler({
      channelName: 'Agent A',
      projectName: 'proj',
      baseDirectory: '/repo',
    });

    let state: 'pending' | 'resolved' | 'rejected' = 'pending';
    run.then(
      () => {
        state = 'resolved';
      },
      () => {
        state = 'rejected';
      },
    );

    await vi.advanceTimersByTimeAsync(15_100);

    expect(state).toBe('rejected');
    expect(mockUpsert).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
  });

  it('registers successfully when detection completes quickly', async () => {
    mockAutoDetect.mockResolvedValueOnce({
      id: 'ses_abc',
      parentId: null,
    });

    const handler = getToolHandler('conn-ok');
    const result = await handler({
      channelName: 'Agent A',
      projectName: 'proj',
      baseDirectory: '/repo',
    });

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      connectionId: string;
      openCodeSessionId: string | null;
    };

    expect(payload.ok).toBe(true);
    expect(payload.connectionId).toBe('conn-ok');
    expect(payload.openCodeSessionId).toBe('ses_abc');
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockCreateSessionChannel).toHaveBeenCalledWith('conn-ok', 'Agent A');
  });
});
