import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
  ipcMainOn: vi.fn(),
  appGetVersion: vi.fn(() => '1.2.3-test'),
  appSetLoginItemSettings: vi.fn(),
  createOpenCodeSession: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: 'opencode-session-1' },
  }),
  injectClaudeMessageForConnection: vi.fn(),
  listSkillsAndInstructions: vi.fn(() => []),
  matchSkillsForMessage: vi.fn(() => []),
  buildSkillSuggestionText: vi.fn(() => ''),
  sdkPermissionReply: vi.fn(),
  getRegisteredConnectionBySessionId: vi.fn(() => null),
  upsertRegisteredConnection: vi.fn(),
  refreshSessionTreeCache: vi.fn(),
  triggerSessionTreeUpdate: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: mocks.appGetVersion,
    setLoginItemSettings: mocks.appSetLoginItemSettings,
  },
  ipcMain: {
    handle: mocks.ipcMainHandle,
    on: mocks.ipcMainOn,
  },
  dialog: {
    showOpenDialog: vi
      .fn()
      .mockResolvedValue({ canceled: true, filePaths: [] }),
  },
  BrowserWindow: class {},
}));

vi.mock('../settings', () => ({
  saveSettings: vi.fn(),
}));

vi.mock('../opencode/injector', () => ({
  injectOpenCodeMessage: vi.fn().mockResolvedValue({ ok: true, noReply: true }),
  SUPPORTED_FILE_EXTENSIONS: ['txt', 'md', 'png'],
}));

vi.mock('../opencode/session', () => ({
  autoDetectOpenCodeSessionId: vi.fn().mockResolvedValue(null),
  createOpenCodeSession: mocks.createOpenCodeSession,
}));

vi.mock('../database', () => ({
  getConversationHistory: vi.fn(() => []),
  clearHistory: vi.fn(),
  queueSessionMessage: vi.fn(),
  getActiveSessionChannels: vi.fn(() => []),
  getSessionChannelHistory: vi.fn(() => []),
  clearSessionChannelMessages: vi.fn(),
  deleteSessionChannel: vi.fn(),
  deleteRegisteredConnection: vi.fn(),
  getRegisteredConnection: vi.fn(() => null),
  getRegisteredConnectionBySessionId: mocks.getRegisteredConnectionBySessionId,
  resetDatabase: vi.fn(),
  upsertRegisteredConnection: mocks.upsertRegisteredConnection,
  upsertSkillOrInstruction: vi.fn(),
  listSkillsAndInstructions: mocks.listSkillsAndInstructions,
  getSkillOrInstructionByName: vi.fn(() => null),
  deleteSkillOrInstruction: vi.fn(() => false),
  updateConnectionBaseDirectory: vi.fn(),
}));

vi.mock('../tools/skill-match', () => ({
  matchSkillsForMessage: mocks.matchSkillsForMessage,
  buildSkillSuggestionText: mocks.buildSkillSuggestionText,
}));

vi.mock('../docs/context-injector', () => ({
  searchDocs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../docs/inject-handler', () => ({
  handleInjectDocContext: vi
    .fn()
    .mockResolvedValue({ ok: true, injectedCount: 0 }),
}));

vi.mock('../mcp-server', () => ({
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
  restartMcpServer: vi.fn().mockResolvedValue(undefined),
  softRestartMcpServer: vi.fn().mockResolvedValue(0),
  closeSessionByConnectionId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../docs/file-indexer', () => ({
  indexFiles: vi.fn().mockResolvedValue([]),
  rankFileSuggestions: vi.fn(() => []),
}));

vi.mock('./prompt', () => ({
  forceTerminateChat: vi.fn(),
}));

vi.mock('../tools/connection-guard', () => ({
  markConnectionDeleted: vi.fn(),
}));

vi.mock('../session/tree-manager', () => ({
  triggerSessionTreeUpdate: mocks.triggerSessionTreeUpdate,
  tombstoneOpenCodeSession: vi.fn(),
  refreshSessionTreeCache: mocks.refreshSessionTreeCache,
}));

vi.mock('../opencode/server', () => ({
  startOpenCodeServer: vi.fn(),
  stopOpenCodeServer: vi.fn(),
}));

vi.mock('../opencode/config-sync', () => ({
  syncRemoteConfig: vi.fn(() => 'ok'),
}));

vi.mock('../opencode/mcp-register', () => ({
  registerMcpAcrossReachablePorts: vi
    .fn()
    .mockResolvedValue({ status: 'registered' }),
}));

vi.mock('../remove-persisted-session', () => ({
  removePersistedSession: vi.fn().mockResolvedValue(true),
}));

vi.mock('../backend-adapter', () => ({
  getBackendAdapter: vi.fn().mockResolvedValue({
    supportsProviderInjection: true,
    supportsSessionHierarchy: true,
    runtime: 'test-runtime',
  }),
}));

vi.mock('../claude-sdk-runtime', () => ({
  injectClaudeMessageForConnection: mocks.injectClaudeMessageForConnection,
}));

vi.mock('../opencode/sdk-client', () => ({
  getClient: vi.fn(() => ({
    permission: {
      reply: mocks.sdkPermissionReply,
    },
  })),
}));

vi.mock('../opencode/permission-reply', () => ({
  replyToOpenCodePermission: vi.fn(
    async (_openCodePort, _sessionID, requestID, reply) => {
      try {
        const result = await mocks.sdkPermissionReply({ requestID, reply });
        if (result?.error) {
          return { ok: false, error: String(result.error) };
        }
        return { ok: true };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  ),
}));

vi.mock('../session/resolver', () => ({
  resolveSession: vi.fn().mockResolvedValue({
    providerSessionId: null,
    parentSessionId: null,
    resolvedVia: 'none',
  }),
  reResolveStaleSession: vi.fn().mockResolvedValue({
    providerSessionId: null,
    parentSessionId: null,
    resolvedVia: 'none',
  }),
}));

import { registerIpcHandlers } from './handlers';
import { queueSessionMessage } from '../database';
import { injectOpenCodeMessage } from '../opencode/injector';
import { registerMcpAcrossReachablePorts } from '../opencode/mcp-register';

function getRegisteredHandle(channel: string) {
  const call = mocks.ipcMainHandle.mock.calls.find(
    ([registeredChannel]: [string]) => registeredChannel === channel,
  );
  expect(call).toBeDefined();
  return call?.[1] as (...args: unknown[]) => unknown;
}

function registerHandlers() {
  registerIpcHandlers({
    getMainWindow: () => null,
    getSettings: () => ({
      port: 3100,
      promptTimeoutSeconds: 30,
      openCodePort: 4096,
      soundEnabled: false,
      agentBackend: 'claude_sdk',
      autoStartOpenCode: false,
      autoSyncOpencode: false,
      launchAtLogin: false,
      docContextDebug: false,
      docIndexingEnabled: true,
      autoRestoreSessions: false,
      autoRegisterSubagents: true,
      extraMcpServers: '',
    }),
    setSettings: vi.fn(),
  });
}

function registerHandlersWithBackend(agentBackend: 'opencode' | 'claude_sdk') {
  registerIpcHandlers({
    getMainWindow: () => null,
    getSettings: () => ({
      port: 3100,
      promptTimeoutSeconds: 30,
      openCodePort: 4096,
      soundEnabled: false,
      agentBackend,
      autoStartOpenCode: false,
      autoSyncOpencode: false,
      launchAtLogin: false,
      docContextDebug: false,
      docIndexingEnabled: true,
      autoRestoreSessions: false,
      autoRegisterSubagents: true,
      extraMcpServers: '',
    }),
    setSettings: vi.fn(),
  });
}

describe('registerIpcHandlers reply-permission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the reply-permission channel', () => {
    registerHandlers();
    const channels = mocks.ipcMainHandle.mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain('reply-permission');
  });

  it('calls SDK permission.reply with correct parameters', async () => {
    mocks.sdkPermissionReply.mockResolvedValue({ data: {}, error: null });
    mocks.getRegisteredConnectionBySessionId.mockReturnValue({
      baseDirectory: '/repo',
    });
    registerHandlers();

    const handler = getRegisteredHandle('reply-permission');
    const result = await handler(
      {},
      { sessionID: 'sess-abc', requestID: 'req-123', reply: 'once' },
    );

    expect(mocks.sdkPermissionReply).toHaveBeenCalledWith({
      requestID: 'req-123',
      reply: 'once',
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false when SDK returns an error', async () => {
    mocks.sdkPermissionReply.mockResolvedValue({
      data: null,
      error: 'Permission not found',
    });
    registerHandlers();

    const handler = getRegisteredHandle('reply-permission');
    const result = await handler(
      {},
      { sessionID: 'sess-abc', requestID: 'req-123', reply: 'reject' },
    );

    expect(result).toEqual({ ok: false, error: 'Permission not found' });
  });

  it('returns ok:false when SDK throws', async () => {
    mocks.sdkPermissionReply.mockRejectedValue(new Error('Network error'));
    registerHandlers();

    const handler = getRegisteredHandle('reply-permission');
    const result = await handler(
      {},
      { sessionID: 'sess-abc', requestID: 'req-123', reply: 'always' },
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('Network error'),
    });
  });
});

describe('registerIpcHandlers inject-claude-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok/sessionId/responseText and forwards expected args', async () => {
    const expectedResult = {
      ok: true,
      sessionId: 'session-123',
      responseText: 'Injected successfully',
    };
    mocks.injectClaudeMessageForConnection.mockResolvedValue(expectedResult);

    registerHandlers();

    const handler = getRegisteredHandle('inject-claude-message');
    const request = {
      connectionId: 'conn-1',
      message: 'Please inject this message',
      baseDirectory: '/repo/path',
      attachments: [
        {
          data: 'ZGF0YQ==',
          mimeType: 'text/plain',
          name: 'note.txt',
          size: 4,
        },
      ],
    };

    const result = await handler({}, request);

    expect(mocks.injectClaudeMessageForConnection).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      message: 'Please inject this message',
      baseDirectory: '/repo/path',
      attachments: request.attachments,
    });
    expect(result).toEqual(expectedResult);
  });

  it('returns ok:false with error when runtime reports failure', async () => {
    mocks.injectClaudeMessageForConnection.mockResolvedValue({
      ok: false,
      error: 'runtime unavailable',
    });

    registerHandlers();

    const handler = getRegisteredHandle('inject-claude-message');
    const result = await handler({}, { connectionId: 'conn-2', message: 'Hi' });

    expect(result).toEqual({ ok: false, error: 'runtime unavailable' });
  });

  it('still registers existing IPC handlers', () => {
    registerHandlers();

    const registeredChannels = mocks.ipcMainHandle.mock.calls.map(
      ([channel]: [string]) => channel,
    );

    expect(registeredChannels).toEqual(
      expect.arrayContaining([
        'get-history',
        'save-settings',
        'inject-opencode-message',
        'inject-doc-context',
        'inject-claude-message',
        'resolve-session',
        're-resolve-session',
      ]),
    );
    expect(mocks.ipcMainOn).toHaveBeenCalledWith(
      'queue-session-message',
      expect.any(Function),
    );
  });
});

describe('registerIpcHandlers skill auto-match — queue-session-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getQueueOnHandler() {
    registerHandlers();
    const call = mocks.ipcMainOn.mock.calls.find(
      (c: unknown[]) => c[0] === 'queue-session-message',
    );
    expect(call).toBeDefined();
    return call![1] as (
      _event: unknown,
      data: { sessionId: string; message: string },
    ) => void;
  }

  it('prepends skill suggestion when skills match the message', () => {
    const matchedSkill = { name: 'code-review', description: 'Reviews code' };
    mocks.listSkillsAndInstructions.mockReturnValue([
      matchedSkill,
    ] as unknown as never[]);
    mocks.matchSkillsForMessage.mockReturnValue([
      matchedSkill,
    ] as unknown as never[]);
    mocks.buildSkillSuggestionText.mockReturnValue(
      '<system-reminder>\n[Skill suggestion: The user\'s message may relate to skill "code-review" — consider loading it with the skill tool.]\n</system-reminder>',
    );

    const handler = getQueueOnHandler();
    handler({}, { sessionId: 'ses-1', message: 'Please review my code' });

    expect(queueSessionMessage).toHaveBeenCalledWith(
      'ses-1',
      expect.stringContaining('[Skill suggestion:'),
    );
    expect(queueSessionMessage).toHaveBeenCalledWith(
      'ses-1',
      expect.stringContaining('Please review my code'),
    );
  });

  it('passes message unchanged when no skills match', () => {
    mocks.listSkillsAndInstructions.mockReturnValue([]);
    mocks.matchSkillsForMessage.mockReturnValue([]);
    mocks.buildSkillSuggestionText.mockReturnValue('');

    const handler = getQueueOnHandler();
    handler({}, { sessionId: 'ses-2', message: 'Hello world' });

    expect(queueSessionMessage).toHaveBeenCalledWith('ses-2', 'Hello world');
  });

  it('passes message unchanged when buildSkillSuggestionText returns empty string', () => {
    const skill = { name: 'some-skill', description: 'Does something' };
    mocks.listSkillsAndInstructions.mockReturnValue([
      skill,
    ] as unknown as never[]);
    mocks.matchSkillsForMessage.mockReturnValue([skill] as unknown as never[]);
    mocks.buildSkillSuggestionText.mockReturnValue('');

    const handler = getQueueOnHandler();
    handler({}, { sessionId: 'ses-3', message: 'some message' });

    expect(queueSessionMessage).toHaveBeenCalledWith('ses-3', 'some message');
  });
});

describe('registerIpcHandlers skill auto-match — inject-opencode-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getInjectHandle() {
    registerHandlers();
    const call = mocks.ipcMainHandle.mock.calls.find(
      (c: unknown[]) => c[0] === 'inject-opencode-message',
    );
    expect(call).toBeDefined();
    return call![1] as (
      _event: unknown,
      data: { openCodeSessionId: string; message: string },
    ) => Promise<{ ok: boolean }>;
  }

  it('prepends skill suggestion to injected message when skills match', async () => {
    const matchedSkill = { name: 'debugging', description: 'Debug issues' };
    mocks.listSkillsAndInstructions.mockReturnValue([
      matchedSkill,
    ] as unknown as never[]);
    mocks.matchSkillsForMessage.mockReturnValue([
      matchedSkill,
    ] as unknown as never[]);
    mocks.buildSkillSuggestionText.mockReturnValue(
      '<system-reminder>\n[Skill suggestion: The user\'s message may relate to skill "debugging" — consider loading it with the skill tool.]\n</system-reminder>',
    );
    (injectOpenCodeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });

    const handler = getInjectHandle();
    await handler(
      {},
      { openCodeSessionId: 'oc-ses-1', message: 'Debug this error' },
    );

    expect(injectOpenCodeMessage).toHaveBeenCalledWith(
      'oc-ses-1',
      expect.stringContaining('[Skill suggestion:'),
      undefined,
      expect.any(Number),
      expect.any(Number),
      true,
      undefined,
    );
    expect(injectOpenCodeMessage).toHaveBeenCalledWith(
      'oc-ses-1',
      expect.stringContaining('Debug this error'),
      undefined,
      expect.any(Number),
      expect.any(Number),
      true,
      undefined,
    );
  });

  it('passes message unchanged to inject when no skills match', async () => {
    mocks.listSkillsAndInstructions.mockReturnValue([]);
    mocks.matchSkillsForMessage.mockReturnValue([]);
    mocks.buildSkillSuggestionText.mockReturnValue('');
    (injectOpenCodeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });

    const handler = getInjectHandle();
    await handler(
      {},
      { openCodeSessionId: 'oc-ses-2', message: 'Just a message' },
    );

    expect(injectOpenCodeMessage).toHaveBeenCalledWith(
      'oc-ses-2',
      'Just a message',
      undefined,
      expect.any(Number),
      expect.any(Number),
      true,
      undefined,
    );
  });
});

describe('registerIpcHandlers create-opencode-session model selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOpenCodeSession.mockResolvedValue({
      ok: true,
      session: { id: 'opencode-session-1' },
    });
    (injectOpenCodeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });
  });

  it('injects initial message with model override when model selection is provided', async () => {
    registerHandlersWithBackend('opencode');

    const handler = getRegisteredHandle('create-opencode-session');
    const result = await handler(
      {},
      {
        initialMessage: 'Use this model for this task',
        baseDirectory: '/repo/path',
        modelSelection: {
          providerId: 'github-copilot',
          modelId: 'claude-opus-4.5',
          variant: 'high',
        },
      },
    );

    expect(result).toEqual({ ok: true, sessionId: 'opencode-session-1' });

    expect(mocks.createOpenCodeSession).toHaveBeenCalledWith(4096, {
      title: undefined,
      parentID: undefined,
      initialMessage: undefined,
      directory: '/repo/path',
    });

    expect(mocks.upsertRegisteredConnection).toHaveBeenCalledWith({
      providerType: 'opencode',
      providerSessionId: 'opencode-session-1',
      connectionId: null,
      channelName: 'New Session',
      projectName: 'path',
      baseDirectory: '/repo/path',
      parentSessionId: null,
    });

    expect(mocks.refreshSessionTreeCache).toHaveBeenCalledTimes(1);
    expect(
      mocks.upsertRegisteredConnection.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.refreshSessionTreeCache.mock.invocationCallOrder[0]);

    expect(injectOpenCodeMessage).toHaveBeenCalledWith(
      'opencode-session-1',
      'Use this model for this task',
      undefined,
      4096,
      3100,
      false,
      {
        providerId: 'github-copilot',
        modelId: 'claude-opus-4.5',
        variant: 'high',
      },
    );
  });
});

describe('registerIpcHandlers refresh-session-tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes session tree without re-registering MCP', async () => {
    registerHandlersWithBackend('opencode');

    const handler = getRegisteredHandle('refresh-session-tree');
    await handler({});

    // Should NOT re-register MCP on refresh - that causes duplicate direct
    // connections because OpenCode might reconnect and trigger autoRegister.
    expect(registerMcpAcrossReachablePorts).not.toHaveBeenCalled();
  });
});

describe('registerIpcHandlers sync-opencode-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses multi-port MCP registration and returns combined status string', async () => {
    registerHandlersWithBackend('opencode');

    const handler = getRegisteredHandle('sync-opencode-config');
    const result = await handler({});

    expect(registerMcpAcrossReachablePorts).toHaveBeenCalledWith({
      appPort: 3100,
      openCodePort: 4096,
      promptTimeoutSeconds: 30,
    });
    expect(result).toContain('register=registered');
  });
});
