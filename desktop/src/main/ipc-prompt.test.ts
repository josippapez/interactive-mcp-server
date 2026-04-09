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
import { promptUser, cancelActivePrompt, setPromptTimeout } from './ipc-prompt';
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

  // ── AbortSignal tests ───────────────────────────────────────────────────────

  describe('AbortSignal support', () => {
    it('resolves with abort error when signal is already aborted (before prompt is active)', async () => {
      const win = createMockWindow();
      vi.mocked(ipcMain.on).mockImplementation(() => ipcMain);

      const abortController = new AbortController();
      abortController.abort();

      const result = await promptUser(
        win as never,
        createPromptData({ connectionId: 'conn-pre-aborted' }),
        abortController.signal,
      );
      expect(result.answer).toContain('aborted');
    });

    it('attaches to existing durable prompt when signal fires and new call arrives', async () => {
      // Simulate: first call starts a prompt, transport drops (signal aborts),
      // agent retries — second call should attach to the same durable prompt.
      const win = createMockWindow();
      const handlers: IpcListener[] = [];
      vi.mocked(ipcMain.on).mockImplementation(
        (_channel: string, handler: IpcListener) => {
          handlers.push(handler);
          return ipcMain;
        },
      );

      const abortController = new AbortController();
      const data = createPromptData({
        id: 'durable-prompt',
        connectionId: 'conn-durable',
      });

      // First call: sets up the durable prompt
      const first = promptUser(win as never, data, abortController.signal);

      // Let the queue run so the durable state is established
      await Promise.resolve();
      await Promise.resolve();

      // Second call: same connectionId + same prompt still active
      // (transport dropped and agent retried with a new signal)
      const abortController2 = new AbortController();
      const second = promptUser(win as never, data, abortController2.signal);

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

    it('does not double-resolve if signal aborts after normal response', async () => {
      const win = createMockWindow();

      let capturedHandler: IpcListener | undefined;
      vi.mocked(ipcMain.on).mockImplementation(
        (_channel: string, handler: IpcListener) => {
          capturedHandler = handler;
          return ipcMain;
        },
      );

      const abortController = new AbortController();

      const promise = promptUser(
        win as never,
        createPromptData({
          id: 'prompt-no-double',
          connectionId: 'conn-no-double',
        }),
        abortController.signal,
      );

      // User responds first
      capturedHandler?.({} as IpcMainEvent, {
        id: 'prompt-no-double',
        answer: 'Hello',
      });

      // Then signal aborts (should be a no-op)
      abortController.abort();

      const result = await promise;
      expect(result).toEqual({ answer: 'Hello', attachments: undefined });
    });

    it('prompt without signal still works (backward compatible)', async () => {
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
