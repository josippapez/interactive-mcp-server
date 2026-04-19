import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcMainEvent } from 'electron';

// ── Mock electron ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
    listenerCount: vi.fn(() => 0),
  },
  shell: {
    beep: vi.fn(),
  },
}));

vi.mock('../database', () => ({
  saveConversation: vi.fn(),
  appendSessionChannelMessage: vi.fn(),
  getRegisteredConnection: vi.fn(() => null),
  getRegisteredConnectionBySessionId: vi.fn(() => null),
}));

import { ipcMain } from 'electron';
import {
  promptUser,
  cancelActivePrompt,
  forceTerminateChat,
  setPromptTimeout,
  __resetPromptStateForTests,
} from './prompt';
import {
  appendSessionChannelMessage,
  getRegisteredConnection,
} from '../database';
import type { PromptData } from './prompt';

// The IPC listener signature that ipcMain.on expects
type IpcListener = (event: IpcMainEvent, ...args: unknown[]) => void;

function createMockWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

function createPromptData(
  overrides: Partial<PromptData> & { openCodeSessionId?: string | null } = {},
): PromptData {
  // Accept `openCodeSessionId` as a legacy alias for `providerSessionId` so
  // existing test cases read naturally. The production type only has
  // `providerSessionId`. Default to a non-null value so tests that do not
  // care about session-id resolution can run without tripping the
  // "providerSessionId could not be resolved" guard in prompt.ts.
  const { openCodeSessionId, providerSessionId, ...rest } = overrides;
  const resolvedProviderSessionId =
    providerSessionId !== undefined
      ? providerSessionId
      : openCodeSessionId !== undefined
        ? openCodeSessionId
        : 'ses_test_default';
  return {
    id: 'prompt-1',
    message: 'test message',
    projectName: 'test-project',
    connectionId: 'conn-1',
    connectionName: 'Agent 1',
    timeoutSeconds: 60,
    expiresAt: 0,
    providerSessionId: resolvedProviderSessionId,
    ...rest,
  };
}

describe('promptUser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a short prompt timeout for tests
    setPromptTimeout(() => 5000);
    __resetPromptStateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves when user responds via IPC', async () => {
    const win = createMockWindow();
    const data = createPromptData();

    // Capture the handler registered on ipcMain
    let capturedHandler: IpcListener | undefined;
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        capturedHandler = handler;
        return ipcMain;
      },
    );

    const promise = promptUser(win as never, data);

    // Simulate user response
    capturedHandler?.({} as IpcMainEvent, { id: 'prompt-1', answer: 'Yes' });

    const result = await promise;
    expect(result).toEqual({ answer: 'Yes', attachments: undefined });
  });

  it('resolves with error when window is null', async () => {
    const result = await promptUser(null, createPromptData());
    expect(result.answer).toContain('Error');
  });

  it('resolves with error when window is destroyed', async () => {
    const win = createMockWindow();
    win.isDestroyed.mockReturnValue(true);
    const result = await promptUser(win as never, createPromptData());
    expect(result.answer).toContain('Error');
  });

  it('resolves with null answer when prompt times out', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(win as never, createPromptData());

    // Advance past the 5 s timeout — the promise should resolve with null.
    vi.advanceTimersByTime(6000);
    const result = await promise;
    expect(result.answer).toBeNull();

    // Expired prompts are cleared immediately so the UI does not accept stale replies.
    expect(win.webContents.send).toHaveBeenCalledWith(
      'prompt-clear',
      expect.objectContaining({ providerSessionId: 'ses_test_default' }),
    );
    expect(appendSessionChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'ses_test_default',
        messageType: 'agent_message',
        messageText: expect.stringContaining('Prompt expired'),
      }),
    );
  });

  it('sends prompt-clear immediately when the prompt times out', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(win as never, createPromptData());

    vi.advanceTimersByTime(6000);
    await promise;

    expect(win.webContents.send).toHaveBeenCalledWith(
      'prompt-clear',
      expect.objectContaining({ providerSessionId: 'ses_test_default' }),
    );
  });

  it('resolves with cancel message when cancelActivePrompt is called', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({ connectionId: 'conn-cancel' }),
    );
    cancelActivePrompt('conn-cancel');
    const result = await promise;
    expect(result.answer).toContain('superseded');
  });

  it('queues prompts for same connection instead of superseding', async () => {
    const win = createMockWindow();
    const handlers: IpcListener[] = [];

    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );

    const first = promptUser(
      win as never,
      createPromptData({ id: 'prompt-a', connectionId: 'conn-shared' }),
    );
    const second = promptUser(
      win as never,
      createPromptData({ id: 'prompt-b', connectionId: 'conn-shared' }),
    );

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenNthCalledWith(
      1,
      'prompt-request',
      expect.objectContaining({
        id: 'prompt-a',
        providerSessionId: 'ses_test_default',
      }),
    );

    handlers[0]?.({} as IpcMainEvent, { id: 'prompt-a', answer: 'first' });
    await expect(first).resolves.toEqual({
      answer: 'first',
      attachments: undefined,
    });

    // Second prompt is displayed only after the first settles.
    // Call sequence: [1] prompt-request(a), [2] prompt-clear(a), [3] prompt-request(b)
    expect(win.webContents.send).toHaveBeenCalledTimes(3);
    expect(win.webContents.send).toHaveBeenNthCalledWith(
      2,
      'prompt-clear',
      expect.objectContaining({
        id: 'prompt-a',
        providerSessionId: 'ses_test_default',
      }),
    );
    expect(win.webContents.send).toHaveBeenNthCalledWith(
      3,
      'prompt-request',
      expect.objectContaining({
        id: 'prompt-b',
        providerSessionId: 'ses_test_default',
      }),
    );

    handlers[0]?.({} as IpcMainEvent, { id: 'prompt-b', answer: 'second' });
    await expect(second).resolves.toEqual({
      answer: 'second',
      attachments: undefined,
    });
  });

  it('cancels queued prompts when connection is cancelled', async () => {
    const win = createMockWindow();
    const handlers: IpcListener[] = [];

    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );

    const first = promptUser(
      win as never,
      createPromptData({ id: 'prompt-c', connectionId: 'conn-close' }),
    );
    const second = promptUser(
      win as never,
      createPromptData({ id: 'prompt-d', connectionId: 'conn-close' }),
    );

    cancelActivePrompt('conn-close');

    await expect(first).resolves.toEqual(
      expect.objectContaining({
        answer: expect.stringContaining('superseded'),
      }),
    );
    await expect(second).resolves.toEqual(
      expect.objectContaining({
        answer: expect.stringContaining('cancelled before display'),
      }),
    );

    // Queued prompt was never displayed.
    // Call sequence: [1] prompt-request(c), [2] prompt-clear(c) from cancel path.
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'prompt-request',
      expect.objectContaining({ id: 'prompt-c' }),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      'prompt-clear',
      expect.objectContaining({ providerSessionId: 'ses_test_default' }),
    );
  });
});

describe('cancelActivePrompt sends prompt-clear to renderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 5000);
    __resetPromptStateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls win.webContents.send with prompt-clear when cancelling an active prompt', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({
        id: 'prompt-cancel-clear',
        connectionId: 'conn-cancel-clear',
      }),
    );

    // Let the queue run so the durable state is fully established
    await Promise.resolve();
    await Promise.resolve();

    cancelActivePrompt('conn-cancel-clear');
    await promise;

    expect(win.webContents.send).toHaveBeenCalledWith(
      'prompt-clear',
      expect.objectContaining({ providerSessionId: 'ses_test_default' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Durable prompt — transport resilience
// ─────────────────────────────────────────────────────────────────────────────

describe('durable prompt — transport resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 60_000); // 60 s — long enough to simulate reconnects
    __resetPromptStateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prompt survives AbortSignal fire and delivers answer to retry call', async () => {
    // Scenario: Agent calls promptUser with signal1. Transport drops — signal1
    // aborts. Agent retries via transparent reinit, calls promptUser again with
    // signal2. The durable prompt stays alive and both calls get the answer
    // when the user finally replies.
    const win = createMockWindow();
    const handlers: IpcListener[] = [];
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );

    const abort1 = new AbortController();
    const data = createPromptData({
      id: 'transport-survive-1',
      connectionId: 'conn-transport-survive',
    });

    // First call — starts the durable prompt
    const first = promptUser(win as never, data, abort1.signal);
    await Promise.resolve();
    await Promise.resolve();

    // Simulate transport drop — abort the signal
    abort1.abort();

    // The prompt should NOT be resolved by the abort — it stays alive
    // Advance time a bit to ensure no resolution
    await Promise.resolve();
    await Promise.resolve();

    // Agent retries — calls promptUser again (transparent reinit path)
    const abort2 = new AbortController();
    const second = promptUser(win as never, data, abort2.signal);
    await Promise.resolve();
    await Promise.resolve();

    // Only ONE prompt-request should have been sent to the renderer
    const promptRequests = vi
      .mocked(win.webContents.send)
      .mock.calls.filter((c) => c[0] === 'prompt-request');
    expect(promptRequests).toHaveLength(1);

    // User finally replies
    handlers[0]?.({} as IpcMainEvent, {
      id: 'transport-survive-1',
      answer: 'After reconnect',
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({
      answer: 'After reconnect',
      attachments: undefined,
    });
    expect(r2).toEqual({
      answer: 'After reconnect',
      attachments: undefined,
    });
  });

  it('prompt with zero timeout (infinite) stays alive indefinitely', async () => {
    setPromptTimeout(() => 0); // 0 = no timeout (infinite)

    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const data = createPromptData({
      id: 'infinite-timeout',
      connectionId: 'conn-infinite',
    });

    const promise = promptUser(win as never, data);
    await Promise.resolve();
    await Promise.resolve();

    // Advance time by a very large amount — prompt should NOT time out
    vi.advanceTimersByTime(86_400_000); // 24 hours
    await Promise.resolve();

    // The promise should still be pending (not resolved)
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Clean up — cancel to prevent hanging test
    cancelActivePrompt('conn-infinite');
    await promise;
  });

  it('multiple transport drops — prompt survives all and delivers to last caller', async () => {
    const win = createMockWindow();
    const handlers: IpcListener[] = [];
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );

    const data = createPromptData({
      id: 'multi-drop',
      connectionId: 'conn-multi-drop',
    });

    // First call
    const abort1 = new AbortController();
    const first = promptUser(win as never, data, abort1.signal);
    await Promise.resolve();
    await Promise.resolve();

    // Transport drops
    abort1.abort();
    await Promise.resolve();

    // Second call (retry 1)
    const abort2 = new AbortController();
    const second = promptUser(win as never, data, abort2.signal);
    await Promise.resolve();
    await Promise.resolve();

    // Transport drops again
    abort2.abort();
    await Promise.resolve();

    // Third call (retry 2)
    const abort3 = new AbortController();
    const third = promptUser(win as never, data, abort3.signal);
    await Promise.resolve();
    await Promise.resolve();

    // Only one prompt-request sent total
    const promptRequests = vi
      .mocked(win.webContents.send)
      .mock.calls.filter((c) => c[0] === 'prompt-request');
    expect(promptRequests).toHaveLength(1);

    // User finally answers
    handlers[0]?.({} as IpcMainEvent, {
      id: 'multi-drop',
      answer: 'Third time is the charm',
    });

    const [r1, r2, r3] = await Promise.all([first, second, third]);
    const expected = {
      answer: 'Third time is the charm',
      attachments: undefined,
    };
    expect(r1).toEqual(expected);
    expect(r2).toEqual(expected);
    expect(r3).toEqual(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// promptKey — openCodeSessionId-based keying
// ─────────────────────────────────────────────────────────────────────────────

describe('promptKey — openCodeSessionId keying', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 60_000);
    __resetPromptStateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('attaches retry call to the same durable prompt when keyed by openCodeSessionId', async () => {
    // Scenario: getRegisteredConnection returns an openCodeSessionId.
    // First call creates the prompt keyed on openCodeSessionId.
    // Second call (same connectionId, same openCodeSessionId) should attach
    // to the existing durable prompt — not create a new one.
    const win = createMockWindow();
    const handlers: IpcListener[] = [];

    vi.mocked(getRegisteredConnection).mockReturnValue({
      connectionId: 'conn-key-1',
      providerSessionId: 'ses_key123',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: null,
      parentSessionId: null,
      idFilePath: '/tmp/conn-key-1.json',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      providerType: 'standalone' as const,
    });

    vi.mocked(ipcMain.on).mockImplementation(
      (channel: string, handler: IpcListener) => {
        if (channel === 'prompt-response') handlers.push(handler);
        return ipcMain;
      },
    );

    const data = createPromptData({
      id: 'keyed-prompt-1',
      connectionId: 'conn-key-1',
    });

    const first = promptUser(win as never, data);
    await Promise.resolve();
    await Promise.resolve();

    // Second call — same connectionId, same registered openCodeSessionId
    const second = promptUser(win as never, data);
    await Promise.resolve();
    await Promise.resolve();

    // Only ONE prompt-request should have been sent to renderer
    const promptRequests = vi
      .mocked(win.webContents.send)
      .mock.calls.filter((c) => c[0] === 'prompt-request');
    expect(promptRequests).toHaveLength(1);

    // User replies
    handlers[0]?.({} as IpcMainEvent, {
      id: 'keyed-prompt-1',
      answer: 'keyed answer',
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({ answer: 'keyed answer', attachments: undefined });
    expect(r2).toEqual({ answer: 'keyed answer', attachments: undefined });
  });

  it('cancelActivePrompt resolves a prompt keyed by openCodeSessionId when called with connectionId', async () => {
    const win = createMockWindow();

    vi.mocked(getRegisteredConnection).mockReturnValue({
      connectionId: 'conn-cancel-key',
      providerSessionId: 'ses_cancelkey',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: null,
      parentSessionId: null,
      idFilePath: '/tmp/conn-cancel-key.json',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      providerType: 'standalone' as const,
    });

    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({ connectionId: 'conn-cancel-key' }),
    );

    await Promise.resolve();
    await Promise.resolve();

    // Cancel by connectionId — even though the map key is openCodeSessionId
    cancelActivePrompt('conn-cancel-key');

    const result = await promise;
    expect(result.answer).toContain('superseded');
  });

  it('cancelActivePrompt still settles prompt when session lookup is stale and keying used openCodeSessionId', async () => {
    const win = createMockWindow();

    // During prompt creation, we have explicit openCodeSessionId in tool call.
    // During cancellation, DB lookup is stale and returns null.
    vi.mocked(getRegisteredConnection)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({
        id: 'stale-cancel',
        connectionId: 'conn-stale-cancel',
        openCodeSessionId: 'ses_stale_cancel',
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    cancelActivePrompt('conn-stale-cancel');

    const result = await promise;
    expect(result.answer).toContain('superseded');
  });

  it('forceTerminateChat resolves a prompt keyed by openCodeSessionId when called with connectionId', async () => {
    const win = createMockWindow();

    vi.mocked(getRegisteredConnection).mockReturnValue({
      connectionId: 'conn-force-key',
      providerSessionId: 'ses_forcekey',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: null,
      parentSessionId: null,
      idFilePath: '/tmp/conn-force-key.json',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      providerType: 'standalone' as const,
    });

    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({ connectionId: 'conn-force-key' }),
    );

    await Promise.resolve();
    await Promise.resolve();

    forceTerminateChat('conn-force-key');

    const result = await promise;
    expect(result.answer).toContain('USER_FORCE_TERMINATED');
  });

  it('cancelActivePrompt resolves a prompt when called with providerSessionId (caller has no connectionId)', async () => {
    // Caller (e.g. removePersistedSession) only knows the providerSessionId.
    // The PromptData.connectionId is some unrelated MCP transport handle.
    const win = createMockWindow();

    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({
        id: 'cancel-by-psid',
        connectionId: 'mcp-transport-xyz',
        openCodeSessionId: 'ses_cancel_by_psid',
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    // Cancel using the providerSessionId, not the connectionId
    cancelActivePrompt('ses_cancel_by_psid');

    const result = await promise;
    expect(result.answer).toContain('superseded');
  });

  it('forceTerminateChat resolves a prompt when called with providerSessionId (caller has no connectionId)', async () => {
    const win = createMockWindow();

    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({
        id: 'force-by-psid',
        connectionId: 'mcp-transport-abc',
        openCodeSessionId: 'ses_force_by_psid',
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    forceTerminateChat('ses_force_by_psid');

    const result = await promise;
    expect(result.answer).toContain('USER_FORCE_TERMINATED');
  });

  it('reconnecting agent with a new connectionId but same openCodeSessionId re-attaches to existing prompt', async () => {
    // The KEY scenario: agent reconnects after transport drop.
    // New MCP connection = new connectionId ('conn-new-transport').
    // Same agent session = same openCodeSessionId ('ses_reconnect').
    // The NEW connectionId should attach to the durable prompt created by the OLD connectionId.
    const win = createMockWindow();
    const handlers: IpcListener[] = [];

    // First call: connectionId='conn-old', openCodeSessionId='ses_reconnect'
    vi.mocked(getRegisteredConnection).mockReturnValue({
      connectionId: 'conn-old',
      providerSessionId: 'ses_reconnect',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: null,
      parentSessionId: null,
      idFilePath: '/tmp/conn-old.json',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      providerType: 'standalone' as const,
    });

    vi.mocked(ipcMain.on).mockImplementation(
      (channel: string, handler: IpcListener) => {
        if (channel === 'prompt-response') handlers.push(handler);
        return ipcMain;
      },
    );

    const originalData = createPromptData({
      id: 'reconnect-prompt',
      connectionId: 'conn-old',
    });

    // First call establishes the durable prompt (keyed by 'ses_reconnect')
    const first = promptUser(win as never, originalData);
    await Promise.resolve();
    await Promise.resolve();

    // Now agent reconnects: new connectionId = 'conn-new-transport'
    // getRegisteredConnection for new connectionId also returns same openCodeSessionId
    vi.mocked(getRegisteredConnection).mockReturnValue({
      connectionId: 'conn-new-transport',
      providerSessionId: 'ses_reconnect',
      channelName: 'Agent',
      projectName: 'proj',
      baseDirectory: null,
      parentSessionId: null,
      idFilePath: '/tmp/conn-new.json',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      providerType: 'standalone' as const,
    });

    const retryData = createPromptData({
      id: 'reconnect-prompt', // same prompt ID
      connectionId: 'conn-new-transport', // NEW connectionId
    });

    const second = promptUser(win as never, retryData);
    await Promise.resolve();
    await Promise.resolve();

    // Only ONE prompt-request should have been sent — second re-attaches
    const promptRequests = vi
      .mocked(win.webContents.send)
      .mock.calls.filter((c) => c[0] === 'prompt-request');
    expect(promptRequests).toHaveLength(1);

    // User replies via old IPC handler
    handlers[0]?.({} as IpcMainEvent, {
      id: 'reconnect-prompt',
      answer: 'reconnect answer',
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({ answer: 'reconnect answer', attachments: undefined });
    expect(r2).toEqual({ answer: 'reconnect answer', attachments: undefined });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #2: appendSessionChannelMessage calls use data.connectionId instead of
// the resolved promptKey (openCodeSessionId). When parent and subagent share
// the same connectionId, all history is persisted under the parent's channel.
// ─────────────────────────────────────────────────────────────────────────────

describe('appendSessionChannelMessage — uses resolved session ID, not connectionId', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 5000);
    __resetPromptStateForTests();
    vi.clearAllMocks();

    // Simulate a subagent: DB lookup for connectionId returns openCodeSessionId
    vi.mocked(getRegisteredConnection).mockReturnValue({
      connectionId: 'shared-conn-uuid',
      providerSessionId: 'ses_subagent_hist',
      channelName: 'Subagent',
      projectName: 'test',
      baseDirectory: null,
      parentSessionId: 'ses_parent',
      idFilePath: '/tmp/test.json',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
      providerType: 'standalone' as const,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('persists question under resolved openCodeSessionId when prompt is sent', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);
    vi.mocked(appendSessionChannelMessage).mockClear();

    const data = createPromptData({
      id: 'hist-question-test',
      connectionId: 'shared-conn-uuid',
      openCodeSessionId: 'ses_subagent_hist',
    });

    const promise = promptUser(win as never, data);

    // Let the queue process
    await vi.advanceTimersByTimeAsync(0);

    // The 'question' message should be persisted under 'ses_subagent_hist', not 'shared-conn-uuid'
    const questionCalls = vi
      .mocked(appendSessionChannelMessage)
      .mock.calls.filter((call) => call[0]?.messageType === 'question');

    expect(questionCalls).toHaveLength(1);
    expect(questionCalls[0][0].sessionId).toBe('ses_subagent_hist');

    // Clean up
    cancelActivePrompt('shared-conn-uuid');
    await promise;
  });

  it('persists answer under resolved openCodeSessionId when user responds', async () => {
    const win = createMockWindow();
    let capturedHandler: IpcListener | undefined;
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        capturedHandler = handler;
        return ipcMain;
      },
    );
    vi.mocked(appendSessionChannelMessage).mockClear();

    const data = createPromptData({
      id: 'hist-answer-test',
      connectionId: 'shared-conn-uuid',
      openCodeSessionId: 'ses_subagent_hist',
    });

    const promise = promptUser(win as never, data);

    // Let the queue process so the durable state is established
    await vi.advanceTimersByTimeAsync(0);

    // User responds
    capturedHandler?.({} as IpcMainEvent, {
      id: 'hist-answer-test',
      answer: 'Yes, proceed',
    });

    // Flush microtasks so the durable promise chain resolves the outer promise
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.answer).toBe('Yes, proceed');

    // The 'answer' message should be persisted under 'ses_subagent_hist'
    const answerCalls = vi
      .mocked(appendSessionChannelMessage)
      .mock.calls.filter((call) => call[0]?.messageType === 'answer');

    expect(answerCalls).toHaveLength(1);
    expect(answerCalls[0][0].sessionId).toBe('ses_subagent_hist');
  }, 15_000);

  it('persists timeout expiry message under resolved openCodeSessionId', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);
    vi.mocked(appendSessionChannelMessage).mockClear();

    const data = createPromptData({
      id: 'hist-timeout-test',
      connectionId: 'shared-conn-uuid',
      openCodeSessionId: 'ses_subagent_hist',
    });

    const promise = promptUser(win as never, data);

    // Let the queue run, then advance past the 5s timeout
    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    // The expiry agent_message should be persisted under 'ses_subagent_hist'
    const agentMsgCalls = vi
      .mocked(appendSessionChannelMessage)
      .mock.calls.filter((call) => call[0]?.messageType === 'agent_message');

    expect(agentMsgCalls).toHaveLength(1);
    expect(agentMsgCalls[0][0].sessionId).toBe('ses_subagent_hist');
  }, 15_000);
});

describe('prompt-response listener lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 5000);
    __resetPromptStateForTests();
    vi.clearAllMocks();
    vi.mocked(getRegisteredConnection).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers prompt-response listener only once for multiple active prompts', async () => {
    const win = createMockWindow();
    const handlers: IpcListener[] = [];

    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );

    const first = promptUser(
      win as never,
      createPromptData({
        id: 'listener-a',
        connectionId: 'conn-listener-a',
        providerSessionId: 'ses_listener_a',
      }),
    );
    const second = promptUser(
      win as never,
      createPromptData({
        id: 'listener-b',
        connectionId: 'conn-listener-b',
        providerSessionId: 'ses_listener_b',
      }),
    );

    expect(ipcMain.on).toHaveBeenCalledTimes(1);

    handlers[0]?.({} as IpcMainEvent, { id: 'listener-a', answer: 'A' });
    handlers[0]?.({} as IpcMainEvent, { id: 'listener-b', answer: 'B' });

    await expect(first).resolves.toEqual({
      answer: 'A',
      attachments: undefined,
    });
    await expect(second).resolves.toEqual({
      answer: 'B',
      attachments: undefined,
    });
  });

  it('keeps a single listener with many concurrent prompts', async () => {
    const win = createMockWindow();
    const handlers: IpcListener[] = [];

    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );
    vi.mocked(ipcMain.listenerCount).mockReturnValue(1);

    const promptCount = 20;
    const promises: Array<Promise<{ answer: string | null }>> = [];

    for (let i = 0; i < promptCount; i++) {
      promises.push(
        promptUser(
          win as never,
          createPromptData({
            id: `listener-many-${i}`,
            connectionId: `conn-listener-many-${i}`,
            providerSessionId: `ses_listener_many_${i}`,
          }),
        ) as Promise<{ answer: string | null }>,
      );
    }

    expect(ipcMain.on).toHaveBeenCalledTimes(1);
    expect(ipcMain.listenerCount('prompt-response')).toBe(1);

    for (let i = 0; i < promptCount; i++) {
      handlers[0]?.({} as IpcMainEvent, {
        id: `listener-many-${i}`,
        answer: `answer-${i}`,
      });
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(promptCount);
    expect(results[0]).toEqual({ answer: 'answer-0', attachments: undefined });
    expect(results[promptCount - 1]).toEqual({
      answer: `answer-${promptCount - 1}`,
      attachments: undefined,
    });
  });

  it('removes shared prompt-response listener on state reset', () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    void promptUser(
      win as never,
      createPromptData({
        id: 'listener-reset',
        connectionId: 'conn-listener-reset',
      }),
    );

    __resetPromptStateForTests();

    expect(ipcMain.removeListener).toHaveBeenCalledWith(
      'prompt-response',
      expect.any(Function),
    );
  });
});
