import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
  ipcMainOn: vi.fn(),
  appGetVersion: vi.fn(() => '1.2.3-test'),
  appSetLoginItemSettings: vi.fn(),
  injectClaudeMessageForConnection: vi.fn(),
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

vi.mock('./settings', () => ({
  saveSettings: vi.fn(),
}));

vi.mock('./opencode-injector', () => ({
  injectOpenCodeMessage: vi.fn().mockResolvedValue({ ok: true, noReply: true }),
  SUPPORTED_FILE_EXTENSIONS: ['txt', 'md', 'png'],
}));

vi.mock('./opencode-session', () => ({
  autoDetectOpenCodeSessionId: vi.fn().mockResolvedValue(null),
}));

vi.mock('./database', () => ({
  getConversationHistory: vi.fn(() => []),
  clearHistory: vi.fn(),
  queueSessionMessage: vi.fn(),
  getActiveSessionChannels: vi.fn(() => []),
  getSessionChannelHistory: vi.fn(() => []),
  clearSessionChannelMessages: vi.fn(),
  deleteSessionChannel: vi.fn(),
  deleteRegisteredConnection: vi.fn(),
  getRegisteredConnection: vi.fn(() => null),
}));

vi.mock('./doc-context-injector', () => ({
  searchDocs: vi.fn().mockResolvedValue([]),
}));

vi.mock('./inject-doc-context-handler', () => ({
  handleInjectDocContext: vi
    .fn()
    .mockResolvedValue({ ok: true, injectedCount: 0 }),
}));

vi.mock('./mcp-server', () => ({
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
  restartMcpServer: vi.fn().mockResolvedValue(undefined),
  softRestartMcpServer: vi.fn().mockResolvedValue(0),
  closeSessionByConnectionId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./file-indexer', () => ({
  indexFiles: vi.fn().mockResolvedValue([]),
  rankFileSuggestions: vi.fn(() => []),
}));

vi.mock('./ipc-prompt', () => ({
  forceTerminateChat: vi.fn(),
}));

vi.mock('./tools/connection-guard', () => ({
  markConnectionDeleted: vi.fn(),
}));

vi.mock('./session-tree-manager', () => ({
  triggerSessionTreeUpdate: vi.fn(),
  tombstoneOpenCodeSession: vi.fn(),
}));

vi.mock('./opencode-server', () => ({
  startOpenCodeServer: vi.fn(),
  stopOpenCodeServer: vi.fn(),
}));

vi.mock('./opencode-config-sync', () => ({
  syncRemoteConfig: vi.fn(() => 'ok'),
}));

vi.mock('./opencode-mcp-register', () => ({
  registerMcpWithOpenCode: vi.fn().mockResolvedValue({ status: 'registered' }),
}));

vi.mock('./remove-persisted-session', () => ({
  removePersistedSession: vi.fn().mockResolvedValue(true),
}));

vi.mock('./backend-adapter', () => ({
  getBackendAdapter: vi.fn().mockResolvedValue({
    supportsProviderInjection: true,
    supportsSessionHierarchy: true,
    runtime: 'test-runtime',
  }),
}));

vi.mock('./claude-sdk-runtime', () => ({
  injectClaudeMessageForConnection: mocks.injectClaudeMessageForConnection,
}));

vi.mock('./session-resolver', () => ({
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

import { registerIpcHandlers } from './ipc-handlers';

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
    }),
    setSettings: vi.fn(),
  });
}

describe('registerIpcHandlers reply-permission', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the reply-permission channel', () => {
    registerHandlers();
    const channels = mocks.ipcMainHandle.mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain('reply-permission');
  });

  it('POSTs to the correct OpenCode permission reply endpoint', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    registerHandlers();

    const handler = getRegisteredHandle('reply-permission');
    const result = await handler(
      {},
      { sessionID: 'sess-abc', requestID: 'req-123', reply: 'once' },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4096/session/sess-abc/permission/req-123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ reply: 'once' }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false when the fetch response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    registerHandlers();

    const handler = getRegisteredHandle('reply-permission');
    const result = await handler(
      {},
      { sessionID: 'sess-abc', requestID: 'req-123', reply: 'reject' },
    );

    expect(result).toEqual({ ok: false, error: 'HTTP 404 Not Found' });
  });

  it('returns ok:false when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
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
