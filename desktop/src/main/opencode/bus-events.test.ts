/**
 * Tests for opencode-bus-events.ts
 *
 * Covers:
 *  - permission.asked event → emits permission-asked IPC with connectionId
 *  - permission.replied event → emits permission-replied IPC
 *  - session.status event → emits session-status-update IPC (passthrough)
 *  - Unknown event type → no IPC emitted
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredConnection } from '../database';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  webContentsSend: vi.fn(),
  getAllRegisteredConnections: vi.fn((): RegisteredConnection[] => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
}));

vi.mock('../database', () => ({
  getAllRegisteredConnections: mocks.getAllRegisteredConnections,
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
  openCodeSessionId: string,
) {
  return {
    connectionId,
    channelName: 'Test Agent',
    projectName: 'test',
    baseDirectory: null,
    idFilePath: '/tmp/test.json',
    providerSessionId: openCodeSessionId,
    openCodeSessionId,
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
          always: false,
          tool: { messageID: 'msg-1', callID: 'call-1' },
        },
      },
    };

    handleBusEvent(envelope, win);

    expect(mocks.webContentsSend).toHaveBeenCalledWith('permission-asked', {
      connectionId: 'conn-abc',
      requestId: 'req-001',
      sessionID: 'ses-123',
      permission: 'bash',
      patterns: ['rm -rf *'],
      always: false,
      tool: { messageID: 'msg-1', callID: 'call-1' },
    });
  });

  it('does not emit if no registered connection matches the sessionID', () => {
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

    expect(mocks.webContentsSend).not.toHaveBeenCalled();
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
      requestId: 'req-004',
      sessionID: 'ses-123',
      permission: 'file_write',
      patterns: undefined,
      always: undefined,
      tool: undefined,
      metadata: { path: '/etc/hosts' },
    });
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
