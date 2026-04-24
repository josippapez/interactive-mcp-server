import { describe, expect, it, vi, beforeEach } from 'vitest';

const treeHandlerMocks = vi.hoisted(() => ({
  handleSessionCreated: vi.fn(),
  handleSessionUpdated: vi.fn(),
  handleSessionDeleted: vi.fn(),
}));

vi.mock('./sse-handlers', () => ({
  handleSessionCreated: treeHandlerMocks.handleSessionCreated,
  handleSessionUpdated: treeHandlerMocks.handleSessionUpdated,
  handleSessionDeleted: treeHandlerMocks.handleSessionDeleted,
}));

vi.mock('./event-bridge', () => ({
  bridgeEvent: vi.fn(() => []),
}));

vi.mock('./event-coalesce', () => ({
  createCoalesceState: vi.fn(() => ({ queue: [] })),
  drainFlush: vi.fn(() => []),
  enqueueEvent: vi.fn(),
}));

vi.mock('./sdk-client', () => ({
  getClient: vi.fn(),
}));

vi.mock('./prompt-event-forwarder', () => ({
  forwardPermissionAsked: vi.fn(),
  forwardPermissionReplied: vi.fn(),
  forwardQuestionAsked: vi.fn(),
  forwardQuestionReplied: vi.fn(),
}));

vi.mock('./settings-mirror', () => ({
  getSettingsSnapshot: () => ({
    allowedPermissions: [],
    allowedReadFolders: [],
    autoRegisterSubagents: true,
    openCodePort: 4096,
    logsDir: '',
  }),
  updateSettingsSnapshot: vi.fn(),
}));

vi.mock('./rpc', () => ({
  getMainRpc: () => ({
    emit: vi.fn(),
    request: vi.fn().mockResolvedValue({ connectionId: null }),
  }),
  getMainRpcOrNull: () => ({
    emit: vi.fn(),
    request: vi.fn().mockResolvedValue({ connectionId: null }),
  }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { getClient } from './sdk-client';
import { startEventStream, stopEventStream } from './event-stream';

function makeEnvelope(type: string) {
  return {
    payload: {
      type,
      properties: {
        sessionID: 'ses_123',
        info: {
          id: 'ses_123',
          parentID: null,
          title: 'Session 123',
          directory: '/tmp/project',
          time: { created: 1, updated: 2 },
          version: 'abc',
          summary: null,
        },
      },
    },
  };
}

describe('event-stream session lifecycle handling', () => {
  beforeEach(() => {
    treeHandlerMocks.handleSessionCreated.mockReset();
    treeHandlerMocks.handleSessionUpdated.mockReset();
    treeHandlerMocks.handleSessionDeleted.mockReset();
  });

  it('routes versioned session lifecycle events into the tree manager cache', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield makeEnvelope('session.created.1');
        yield makeEnvelope('session.updated.1');
        yield makeEnvelope('session.deleted.1');
      },
    };

    vi.mocked(getClient).mockReturnValue({
      global: {
        event: vi.fn().mockResolvedValue({ stream }),
      },
    } as never);

    startEventStream({ getPort: () => 4096 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopEventStream();

    expect(treeHandlerMocks.handleSessionCreated).toHaveBeenCalledTimes(1);
    expect(treeHandlerMocks.handleSessionUpdated).toHaveBeenCalledTimes(1);
    expect(treeHandlerMocks.handleSessionDeleted).toHaveBeenCalledTimes(1);
  });
});
