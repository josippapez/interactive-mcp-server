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
  listSkillsAndInstructions: vi.fn().mockReturnValue([]),
  getRegisteredConnection: vi.fn().mockReturnValue(null),
}));

vi.mock('../opencode/session', () => ({
  autoDetectOpenCodeSession: vi.fn(),
}));

vi.mock('../session/tree-manager', () => ({
  triggerSessionTreeUpdate: vi.fn(),
  recordPendingConnection: vi.fn(),
  refreshSessionTreeCache: vi.fn(),
}));

vi.mock('../docs/context-injector', () => ({
  initDocContext: vi.fn(),
}));

vi.mock('../opencode/injector', () => ({
  injectOpenCodeMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../opencode/mcp-inject', () => ({
  injectProjectMcps: vi.fn().mockResolvedValue({
    configFound: false,
    results: [],
    injectedMcps: [],
  }),
  recordInjectedMcps: vi.fn(),
}));

vi.mock('../backend-adapter', () => ({
  getBackendAdapter: vi.fn().mockResolvedValue({
    backend: 'opencode',
    supportsProviderInjection: true,
    supportsSessionHierarchy: true,
    runtime: null,
  }),
}));

import { upsertRegisteredConnection, createSessionChannel } from '../database';
import { autoDetectOpenCodeSession } from '../opencode/session';
import {
  refreshSessionTreeCache,
  triggerSessionTreeUpdate,
} from '../session/tree-manager';

type RegisterConnectionInput = {
  channelName: string;
  projectName: string;
  baseDirectory?: string;
  openCodeSessionId?: string;
};

type RegisterConnectionResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

type RegisterConnectionHandler = (
  input: RegisterConnectionInput,
) => Promise<RegisterConnectionResult>;

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
    () => 'opencode', // getDetectedProvider
  );

  const toolCall = (server.registerTool as Mock).mock.calls[0];
  return toolCall[2] as RegisterConnectionHandler;
}

describe('register_connection tool', () => {
  const mockUpsert = upsertRegisteredConnection as Mock;
  const mockCreateSessionChannel = createSessionChannel as Mock;
  const mockAutoDetect = autoDetectOpenCodeSession as Mock;
  const mockRefreshSessionTreeCache = refreshSessionTreeCache as Mock;
  const mockTriggerSessionTreeUpdate = triggerSessionTreeUpdate as Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    mockUpsert.mockReset();
    mockCreateSessionChannel.mockReset();
    mockAutoDetect.mockReset();
    mockRefreshSessionTreeCache.mockReset();
    mockTriggerSessionTreeUpdate.mockReset();
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
    // Phase 2: single upsert with detected session ID as PK (no pre-register step)
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'ses_abc',
        connectionId: 'conn-ok',
      }),
    );
    expect(mockCreateSessionChannel).toHaveBeenCalledWith('conn-ok', 'Agent A');
  });

  it('registers successfully with an explicitly provided openCodeSessionId', async () => {
    mockAutoDetect.mockResolvedValueOnce(null); // should not be used

    const handler = getToolHandler('conn-subagent-explicit');
    const result = await handler({
      channelName: 'Agent B',
      projectName: 'proj',
      baseDirectory: '/repo',
      openCodeSessionId: 'ses_own_subagent',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      openCodeSessionId: string | null;
    };
    expect(payload.ok).toBe(true);
    expect(payload.openCodeSessionId).toBe('ses_own_subagent');
    // Only one upsert — no pre-register step in Phase 2
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    // Allow fire-and-forget tree refresh/update tasks to complete.
    // updateSessionTreeAfterRegistration calls triggerSessionTreeUpdate twice:
    // 1) optimistically after emitting the node
    // 2) correctively after refreshSessionTreeCache when supportsProviderInjection=true
    await vi.waitFor(() => {
      expect(mockRefreshSessionTreeCache).toHaveBeenCalledTimes(1);
      expect(mockTriggerSessionTreeUpdate).toHaveBeenCalledTimes(2);
    });
  });

  it('uses connectionId as synthetic session ID when detection returns null (non-OpenCode client)', async () => {
    mockAutoDetect.mockResolvedValueOnce(null);

    const handler = getToolHandler('conn-standalone');
    const result = await handler({
      channelName: 'Standalone Agent',
      projectName: 'proj',
      baseDirectory: '/repo',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      openCodeSessionId: string | null;
    };
    expect(payload.ok).toBe(true);
    // openCodeSessionId is null in the response (no session detected)
    expect(payload.openCodeSessionId).toBeNull();
    // But upsert was called with connectionId as the synthetic PK
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'conn-standalone',
        connectionId: 'conn-standalone',
      }),
    );

    // Allow fire-and-forget tree refresh/update tasks to complete.
    // updateSessionTreeAfterRegistration calls triggerSessionTreeUpdate twice:
    // 1) optimistically after emitting the node
    // 2) correctively after refreshSessionTreeCache when supportsProviderInjection=true
    await vi.waitFor(() => {
      expect(mockRefreshSessionTreeCache).toHaveBeenCalledTimes(1);
      expect(mockTriggerSessionTreeUpdate).toHaveBeenCalledTimes(2);
    });
  });

  it('does not return SESSION_ALREADY_CLAIMED error in Phase 2 (no claiming)', async () => {
    // In Phase 2, auto-detection never produces SESSION_ALREADY_CLAIMED.
    // The main agent and subagent each have their own session ID → own row.
    mockAutoDetect.mockResolvedValueOnce({
      id: 'ses_main_agent',
      parentId: null,
    });

    const handler = getToolHandler('conn-main');
    const result = await handler({
      channelName: 'Main Agent',
      projectName: 'proj',
      baseDirectory: '/repo',
    });

    // Should always succeed, never SESSION_ALREADY_CLAIMED
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as { ok: boolean };
    expect(payload.ok).toBe(true);
  });
});
