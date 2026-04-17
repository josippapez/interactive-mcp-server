import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('../database', () => ({
  getAllRegisteredConnections: vi.fn(),
  getRegisteredConnectionBySessionId: vi.fn(),
  updateConnectionOpenCodeSession: vi.fn(),
  upsertRegisteredConnection: vi.fn(),
  isOpenCodeSessionClaimed: vi.fn(),
  isProviderSessionClaimed: vi.fn(),
}));

vi.mock('../opencode/session', () => ({
  fetchRootOpenCodeSessions: vi.fn(),
  expandOpenCodeSessionTree: vi.fn(),
  fetchOpenCodeSession: vi.fn(),
  fetchAllOpenCodeSessions: vi.fn(),
}));

vi.mock('../opencode/injector', () => ({
  injectOpenCodeMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  startSessionTreeManager,
  stopSessionTreeManager,
} from './tree-manager';
import {
  fetchRootOpenCodeSessions,
  expandOpenCodeSessionTree,
  fetchAllOpenCodeSessions,
} from '../opencode/session';
import { getAllRegisteredConnections } from '../database';

const mockFetchRootOpenCodeSessions = fetchRootOpenCodeSessions as Mock;
const mockExpandOpenCodeSessionTree = expandOpenCodeSessionTree as Mock;
const mockFetchAllOpenCodeSessions = fetchAllOpenCodeSessions as Mock;
const mockGetAllRegisteredConnections = getAllRegisteredConnections as Mock;

function makeSseResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  let idx = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (idx < events.length) {
        const frame = `data: ${JSON.stringify(events[idx++])}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }
      await new Promise(() => {});
    },
  });
  return new Response(stream, { status: 200 });
}

describe('session-tree-manager reasoning event mapping', () => {
  beforeEach(() => {
    mockFetchRootOpenCodeSessions.mockReset();
    mockFetchRootOpenCodeSessions.mockResolvedValue([]);
    mockExpandOpenCodeSessionTree.mockReset();
    mockExpandOpenCodeSessionTree.mockResolvedValue([]);
    mockFetchAllOpenCodeSessions.mockReset();
    mockFetchAllOpenCodeSessions.mockResolvedValue([]);
    mockGetAllRegisteredConnections.mockReset();
    mockGetAllRegisteredConnections.mockReturnValue([]);
  });

  it('preserves reasoning part type for message.part.updated.1 events', async () => {
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as BrowserWindow;

    const partUpdatedEvent = {
      payload: {
        type: 'message.part.updated.1',
        aggregate: 'message',
        data: {
          sessionID: 'ses-reasoning',
          part: {
            id: 'reasoning-1',
            messageID: 'msg-1',
            type: 'reasoning',
            text: 'Investigate the bug',
          },
        },
      },
    };

    global.fetch = vi
      .fn()
      .mockResolvedValue(
        makeSseResponse([partUpdatedEvent]),
      ) as unknown as typeof fetch;

    startSessionTreeManager(
      () => win,
      () => 4096,
      () => true,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(send).toHaveBeenCalledWith('conversation-part-event', {
      type: 'part.updated',
      sessionId: 'ses-reasoning',
      messageId: 'msg-1',
      part: expect.objectContaining({
        id: 'reasoning-1',
        type: 'reasoning',
        text: 'Investigate the bug',
      }),
    });

    stopSessionTreeManager();
    global.fetch = undefined as unknown as typeof fetch;
  });
});
