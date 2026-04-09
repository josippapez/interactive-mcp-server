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

vi.mock('./database', () => ({
  saveConversation: vi.fn(),
  appendSessionChannelMessage: vi.fn(),
  getRegisteredConnection: vi.fn(() => null),
}));

import { ipcMain } from 'electron';
import {
  promptUser,
  cancelActivePrompt,
  forceTerminateChat,
  setPromptTimeout,
} from './ipc-prompt';
import { saveConversation, appendSessionChannelMessage } from './database';
import type { PromptData } from './ipc-prompt';

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

function createPromptData(overrides: Partial<PromptData> = {}): PromptData {
  return {
    id: 'prompt-1',
    message: 'test message',
    projectName: 'test-project',
    connectionId: 'conn-1',
    connectionName: 'Agent 1',
    timeoutSeconds: 60,
    expiresAt: 0,
    ...overrides,
  };
}

describe('promptUser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a short prompt timeout for tests
    setPromptTimeout(() => 5000);
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
      expect.objectContaining({ connectionId: 'conn-1' }),
    );
    expect(appendSessionChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'conn-1',
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
      expect.objectContaining({ connectionId: 'conn-1' }),
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
      expect.objectContaining({ id: 'prompt-a', connectionId: 'conn-shared' }),
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
      expect.objectContaining({ id: 'prompt-a', connectionId: 'conn-shared' }),
    );
    expect(win.webContents.send).toHaveBeenNthCalledWith(
      3,
      'prompt-request',
      expect.objectContaining({ id: 'prompt-b', connectionId: 'conn-shared' }),
    );

    handlers[1]?.({} as IpcMainEvent, { id: 'prompt-b', answer: 'second' });
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
      expect.objectContaining({ connectionId: 'conn-close' }),
    );
    expect(handlers).toHaveLength(1);
  });

  // ── Durable prompt re-attach tests ──────────────────────────────────────────

  describe('durable prompt re-attach', () => {
    it('attaches to existing durable prompt when a retry call arrives', async () => {
      // Simulate: first call starts a prompt, transport drops, agent retries —
      // second call should attach to the same durable prompt.
      const win = createMockWindow();
      const handlers: IpcListener[] = [];
      vi.mocked(ipcMain.on).mockImplementation(
        (_channel: string, handler: IpcListener) => {
          handlers.push(handler);
          return ipcMain;
        },
      );

      const data = createPromptData({
        id: 'durable-prompt',
        connectionId: 'conn-durable',
      });

      // First call: sets up the durable prompt
      const first = promptUser(win as never, data);

      // Let the queue run so the durable state is established
      await Promise.resolve();
      await Promise.resolve();

      // Second call: same connectionId + same prompt still active
      // (transport dropped and agent retried)
      const second = promptUser(win as never, data);

      // Prompt should only have been sent to renderer once (not twice)
      expect(win.webContents.send).toHaveBeenCalledTimes(1);
      expect(win.webContents.send).toHaveBeenCalledWith(
        'prompt-request',
        expect.objectContaining({ id: 'durable-prompt' }),
      );

      // User replies — both first and second should resolve with the same answer
      handlers[0]?.({} as IpcMainEvent, {
        id: 'durable-prompt',
        answer: 'Hello from user',
      });

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1).toEqual({ answer: 'Hello from user', attachments: undefined });
      expect(r2).toEqual({ answer: 'Hello from user', attachments: undefined });
    });

    it('basic prompt resolves correctly', async () => {
      const win = createMockWindow();

      let capturedHandler: IpcListener | undefined;
      vi.mocked(ipcMain.on).mockImplementation(
        (_channel: string, handler: IpcListener) => {
          capturedHandler = handler;
          return ipcMain;
        },
      );

      const promise = promptUser(
        win as never,
        createPromptData({ id: 'compat-test', connectionId: 'conn-compat' }),
      );
      capturedHandler?.({} as IpcMainEvent, {
        id: 'compat-test',
        answer: 'works',
      });

      const result = await promise;
      expect(result).toEqual({ answer: 'works', attachments: undefined });
    });

    it('cleans up IPC listener when prompt settles', async () => {
      const win = createMockWindow();
      let capturedHandler: IpcListener | undefined;
      vi.mocked(ipcMain.on).mockImplementation(
        (_channel: string, handler: IpcListener) => {
          capturedHandler = handler;
          return ipcMain;
        },
      );

      const promise = promptUser(
        win as never,
        createPromptData({ connectionId: 'conn-cleanup' }),
      );

      capturedHandler?.({} as IpcMainEvent, {
        id: 'prompt-1',
        answer: 'done',
      });

      await promise;

      expect(ipcMain.removeListener).toHaveBeenCalledWith(
        'prompt-response',
        expect.any(Function),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional durable-prompt coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('forceTerminateChat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 5000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves an active prompt with USER_FORCE_TERMINATED message', async () => {
    const win = createMockWindow();
    vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

    const promise = promptUser(
      win as never,
      createPromptData({ connectionId: 'conn-force' }),
    );

    // Let the queue run so the durable state is established
    await Promise.resolve();
    await Promise.resolve();

    forceTerminateChat('conn-force');

    const result = await promise;
    expect(result.answer).toContain('USER_FORCE_TERMINATED');
  });

  it('is a no-op when there is no active prompt for the connection', () => {
    // Should not throw when called for an unknown connectionId
    expect(() => forceTerminateChat('conn-nonexistent')).not.toThrow();
  });
});

describe('timeout does not fire after normal answer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 5000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not call appendSessionChannelMessage with agent_message after the user answers', async () => {
    const win = createMockWindow();
    let capturedHandler: IpcListener | undefined;
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        capturedHandler = handler;
        return ipcMain;
      },
    );

    vi.mocked(appendSessionChannelMessage).mockClear();

    const promise = promptUser(
      win as never,
      createPromptData({ id: 'prompt-timer', connectionId: 'conn-timer' }),
    );

    // User answers before the timeout fires
    capturedHandler?.({} as IpcMainEvent, {
      id: 'prompt-timer',
      answer: 'answered',
    });
    await promise;

    // Now advance past the configured 5 s timeout — the timer should have
    // been cleared and the expiry callback should NOT run.
    vi.advanceTimersByTime(10_000);

    const agentMessageCalls = vi
      .mocked(appendSessionChannelMessage)
      .mock.calls.filter((call) => call[0]?.messageType === 'agent_message');
    expect(agentMessageCalls).toHaveLength(0);
  });
});

describe('cancelActivePrompt sends prompt-clear to renderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPromptTimeout(() => 5000);
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
      expect.objectContaining({ connectionId: 'conn-cancel-clear' }),
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prompt survives transport drop and delivers answer to retry call', async () => {
    // Scenario: Agent calls promptUser. Transport drops. Agent retries via
    // transparent reinit, calls promptUser again. The durable prompt stays
    // alive and both calls get the answer when the user finally replies.
    const win = createMockWindow();
    const handlers: IpcListener[] = [];
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        handlers.push(handler);
        return ipcMain;
      },
    );

    const data = createPromptData({
      id: 'transport-survive-1',
      connectionId: 'conn-transport-survive',
    });

    // First call — starts the durable prompt
    const first = promptUser(win as never, data);
    await Promise.resolve();
    await Promise.resolve();

    // Agent retries — calls promptUser again (transparent reinit path)
    const second = promptUser(win as never, data);
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
    vi.mocked(ipcMain.on).mockImplementation(
      (_channel: string, handler: IpcListener) => {
        // capture but don't auto-reply
        return ipcMain;
      },
    );

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
    const first = promptUser(win as never, data);
    await Promise.resolve();
    await Promise.resolve();

    // Second call (retry 1 — transport dropped and agent retried)
    const second = promptUser(win as never, data);
    await Promise.resolve();
    await Promise.resolve();

    // Third call (retry 2 — transport dropped again)
    const third = promptUser(win as never, data);
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
