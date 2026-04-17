/**
 * Tests for opencode-bus-events.ts
 *
 * Covers:
 *  - permission.asked event → emits permission-asked IPC with connectionId
 *  - permission.replied event → emits permission-replied IPC
 *  - session.status event → emits session-status-update IPC (passthrough)
 *  - session.idle / session.error / file.edited → new foundation passthroughs
 *  - Unknown event type → no IPC emitted
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredConnection } from '../database';
import { defaultSettings } from '../settings';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  webContentsSend: vi.fn(),
  getAllRegisteredConnections: vi.fn((): RegisteredConnection[] => []),
  replyToOpenCodePermission: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
}));

vi.mock('../database', () => ({
  getAllRegisteredConnections: mocks.getAllRegisteredConnections,
}));

vi.mock('./permission-reply', () => ({
  replyToOpenCodePermission: mocks.replyToOpenCodePermission,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWindow(): {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: { send: ReturnType<typeof vi.fn> };
} {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: mocks.webContentsSend,
    },
  };
}

function makeRegisteredConnection(
  connectionId: string,
  providerSessionId: string,
) {
  return {
    connectionId,
    channelName: 'Test Agent',
    projectName: 'test',
    baseDirectory: null,
    idFilePath: '/tmp/test.json',
    providerSessionId,
    parentSessionId: null,
    providerType: 'standalone' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Import subject ───────────────────────────────────────────────────────────

// We test the internal handler directly via the exported test-only export.
import type { _handleBusEventForTest as HandleBusEventFn } from './bus-events';

let handleBusEvent: typeof HandleBusEventFn;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.replyToOpenCodePermission.mockResolvedValue({ ok: true });

  const mod = await import('./bus-events');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleBusEvent = (mod as any)._handleBusEventForTest;
});

// ─── permission.asked ─────────────────────────────────────────────────────────

describe('opencode-bus-events — permission.asked', () => {
  it('emits permission-asked with connectionId when session is found', () => {
    const win = makeWindow();
    mocks.getAllRegisteredConnections.mockReturnValue([
      makeRegisteredConnection('conn-abc', 'ses-123'),
    ]);

    const envelope = {
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'req-001',
          sessionID: 'ses-123',
          permission: 'bash',
          patterns: ['rm -rf *'],
          always: ['rm -rf *'],
          tool: { messageID: 'msg-1', callID: 'call-1' },
        },
      },
    };

    handleBusEvent(envelope, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith('permission-asked', {
      connectionId: 'conn-abc',
      providerSessionId: 'ses-123',
      requestId: 'req-001',
      sessionID: 'ses-123',
      directory: undefined,
      permission: 'bash',
      patterns: ['rm -rf *'],
      always: ['rm -rf *'],
      tool: { messageID: 'msg-1', callID: 'call-1' },
      metadata: undefined,
    });
  });

  it('falls back to sessionID when no registered connection matches the sessionID', () => {
    const win = makeWindow();
    mocks.getAllRegisteredConnections.mockReturnValue([
      makeRegisteredConnection('conn-abc', 'ses-999'),
    ]);

    const envelope = {
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'req-002',
          sessionID: 'ses-123',
          permission: 'bash',
        },
      },
    };

    handleBusEvent(envelope, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith('permission-asked', {
      connectionId: 'ses-123',
      providerSessionId: 'ses-123',
      requestId: 'req-002',
      sessionID: 'ses-123',
      permission: 'bash',
      patterns: undefined,
      always: undefined,
      tool: undefined,
      metadata: undefined,
    });
  });

  it('does not emit if window is null', () => {
    mocks.getAllRegisteredConnections.mockReturnValue([
      makeRegisteredConnection('conn-abc', 'ses-123'),
    ]);

    const envelope = {
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'req-003',
          sessionID: 'ses-123',
          permission: 'bash',
        },
      },
    };

    handleBusEvent(envelope, null);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });

  it('includes metadata field when present', () => {
    const win = makeWindow();
    mocks.getAllRegisteredConnections.mockReturnValue([
      makeRegisteredConnection('conn-abc', 'ses-123'),
    ]);

    const envelope = {
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'req-004',
          sessionID: 'ses-123',
          permission: 'file_write',
          metadata: { path: '/etc/hosts' },
        },
      },
    };

    handleBusEvent(envelope, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith('permission-asked', {
      connectionId: 'conn-abc',
      providerSessionId: 'ses-123',
      requestId: 'req-004',
      sessionID: 'ses-123',
      permission: 'file_write',
      patterns: undefined,
      always: undefined,
      tool: undefined,
      metadata: { path: '/etc/hosts' },
    });
  });

  it('auto-approves non-read permissions from allowed settings', async () => {
    const win = makeWindow();

    const mod = await import('./bus-event-handler');
    mod.handleBusEvent(
      {
        directory: '/tmp/project',
        payload: {
          type: 'permission.asked',
          properties: {
            id: 'req-005',
            sessionID: 'ses-123',
            permission: 'glob',
            patterns: ['**/*.ts'],
          },
        },
      },
      win as never,
      {
        getOpenCodePort: () => 4096,
        getSettings: () => ({
          ...defaultSettings,
          allowedReadFolders: [],
          allowedPermissions: ['glob'],
        }),
      },
    );

    await Promise.resolve();

    expect(mocks.replyToOpenCodePermission).toHaveBeenCalledWith(
      4096,
      'ses-123',
      'req-005',
      'always',
      '/tmp/project',
    );
    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });
});

// ─── permission.replied ───────────────────────────────────────────────────────

describe('opencode-bus-events — permission.replied', () => {
  it('emits permission-replied IPC event', () => {
    const win = makeWindow();

    const envelope = {
      payload: {
        type: 'permission.replied',
        properties: {
          sessionID: 'ses-123',
          requestID: 'req-001',
          reply: 'once',
        },
      },
    };

    handleBusEvent(envelope, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith('permission-replied', {
      sessionID: 'ses-123',
      requestID: 'req-001',
      reply: 'once',
    });
  });

  it('does not emit if window is null', () => {
    const envelope = {
      payload: {
        type: 'permission.replied',
        properties: {
          sessionID: 'ses-123',
          requestID: 'req-001',
          reply: 'always',
        },
      },
    };

    handleBusEvent(envelope, null);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });
});

describe('opencode-bus-events — question events', () => {
  it('emits question-asked for a session question', () => {
    const win = makeWindow();
    mocks.getAllRegisteredConnections.mockReturnValue([
      makeRegisteredConnection('conn-abc', 'ses-123'),
    ]);

    handleBusEvent(
      {
        payload: {
          type: 'question.asked',
          properties: {
            id: 'q-1',
            sessionID: 'ses-123',
            question: 'Pick one',
            options: [{ label: 'A', description: 'Option A' }],
          },
        },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith('question-asked', {
      connectionId: 'conn-abc',
      providerSessionId: 'ses-123',
      requestId: 'q-1',
      sessionID: 'ses-123',
      questions: [
        {
          question: 'Pick one',
          header: 'Question',
          options: [{ label: 'A', description: '' }],
          multiple: false,
          custom: true,
        },
      ],
      tool: undefined,
    });
  });

  it('emits question-cleared for replied/rejected question events', () => {
    const win = makeWindow();

    handleBusEvent(
      {
        payload: {
          type: 'question.replied',
          properties: {
            requestID: 'q-1',
            sessionID: 'ses-123',
            answer: 'A',
          },
        },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith('question-cleared', {
      requestId: 'q-1',
      sessionID: 'ses-123',
      answer: 'A',
      rejected: false,
    });
  });

  it('emits question-asked when the bus event only contains structured questions', () => {
    const win = makeWindow();
    mocks.getAllRegisteredConnections.mockReturnValue([
      makeRegisteredConnection('conn-abc', 'ses-123'),
    ]);

    handleBusEvent(
      {
        payload: {
          type: 'question.asked',
          properties: {
            id: 'q-2',
            sessionID: 'ses-123',
            questions: [
              {
                header: 'Choice',
                question: 'Pick one',
                options: [{ label: 'A', description: 'Option A' }],
              },
            ],
          },
        },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith('question-asked', {
      connectionId: 'conn-abc',
      providerSessionId: 'ses-123',
      requestId: 'q-2',
      sessionID: 'ses-123',
      questions: [
        {
          header: 'Choice',
          question: 'Pick one',
          options: [{ label: 'A', description: 'Option A' }],
          multiple: false,
          custom: true,
        },
      ],
      tool: undefined,
    });
  });
});

// ─── session.status passthrough ───────────────────────────────────────────────

describe('opencode-bus-events — session.status', () => {
  it('emits session-status-update when connectionId is in properties', () => {
    const win = makeWindow();

    const envelope = {
      payload: {
        type: 'session.status',
        properties: {
          connectionId: 'conn-abc',
          status: 'Working on task...',
          type: 'working',
        },
      },
    };

    handleBusEvent(envelope, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      'session-status-update',
      {
        connectionId: 'conn-abc',
        status: 'Working on task...',
        type: 'working',
      },
    );
  });

  it('does not emit if window is null', () => {
    const envelope = {
      payload: {
        type: 'session.status',
        properties: {
          connectionId: 'conn-abc',
          status: 'Idle',
          type: 'info',
        },
      },
    };

    handleBusEvent(envelope, null);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });
});

// ─── unknown / malformed events ───────────────────────────────────────────────

describe('opencode-bus-events — unknown event', () => {
  it('does nothing for unknown event types', () => {
    const win = makeWindow();

    handleBusEvent({ payload: { type: 'unknown.event', properties: {} } }, win);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });

  it('does nothing for malformed envelope', () => {
    const win = makeWindow();

    handleBusEvent({}, win);
    handleBusEvent({ payload: {} }, win);
    handleBusEvent(null, win);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });
});

// ─── session.idle / session.error / file.edited ───────────────────────────────

describe('opencode-bus-events — session.idle', () => {
  it('emits opencode-session-idle with sessionID', () => {
    const win = makeWindow();

    handleBusEvent(
      {
        payload: {
          type: 'session.idle',
          properties: { sessionID: 'ses_abc' },
        },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      'opencode-session-idle',
      { sessionID: 'ses_abc' },
    );
  });

  it('ignores session.idle without sessionID', () => {
    const win = makeWindow();

    handleBusEvent({ payload: { type: 'session.idle', properties: {} } }, win);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });
});

describe('opencode-bus-events — session.error', () => {
  it('emits opencode-session-error with sessionID and error passthrough', () => {
    const win = makeWindow();

    const error = {
      name: 'ProviderAuthError',
      data: { providerID: 'anthropic', message: 'bad key' },
    };

    handleBusEvent(
      {
        payload: {
          type: 'session.error',
          properties: { sessionID: 'ses_err', error },
        },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      'opencode-session-error',
      { sessionID: 'ses_err', error },
    );
  });

  it('emits with nulls when sessionID and error are missing', () => {
    const win = makeWindow();

    handleBusEvent({ payload: { type: 'session.error', properties: {} } }, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith(
      'opencode-session-error',
      { sessionID: null, error: null },
    );
  });
});

describe('opencode-bus-events — file.edited', () => {
  it('emits opencode-file-edited with directory from envelope', () => {
    const win = makeWindow();

    handleBusEvent(
      {
        directory: '/Users/me/project',
        payload: {
          type: 'file.edited',
          properties: { file: 'src/index.ts' },
        },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith('opencode-file-edited', {
      directory: '/Users/me/project',
      file: 'src/index.ts',
    });
  });

  it('emits with directory=null when envelope has no directory', () => {
    const win = makeWindow();

    handleBusEvent(
      {
        payload: { type: 'file.edited', properties: { file: 'a.txt' } },
      },
      win,
    );

    expect(mocks.webContentsSend).toHaveBeenCalledWith('opencode-file-edited', {
      directory: null,
      file: 'a.txt',
    });
  });

  it('ignores file.edited without a file property', () => {
    const win = makeWindow();

    handleBusEvent({ payload: { type: 'file.edited', properties: {} } }, win);

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
  });
});
