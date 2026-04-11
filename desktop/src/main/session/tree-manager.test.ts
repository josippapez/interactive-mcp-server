import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('../database', () => ({
  getAllRegisteredConnections: vi.fn(),
  updateConnectionOpenCodeSession: vi.fn(),
  upsertRegisteredConnection: vi.fn(),
  isOpenCodeSessionClaimed: vi.fn(),
  isProviderSessionClaimed: vi.fn(),
}));

vi.mock('../opencode/session', () => ({
  fetchAllOpenCodeSessions: vi.fn(),
}));

vi.mock('../opencode/injector', () => ({
  injectOpenCodeMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  triggerSessionTreeUpdate,
  startSessionTreeManager,
  stopSessionTreeManager,
} from './tree-manager';
import {
  getAllRegisteredConnections,
  upsertRegisteredConnection,
  isOpenCodeSessionClaimed,
  isProviderSessionClaimed,
} from '../database';
import { fetchAllOpenCodeSessions } from '../opencode/session';
import { injectOpenCodeMessage } from '../opencode/injector';

const mockInjectOpenCodeMessage = injectOpenCodeMessage as Mock;
const mockGetAllRegisteredConnections = getAllRegisteredConnections as Mock;
const mockUpsertRegisteredConnection = upsertRegisteredConnection as Mock;
const mockIsOpenCodeSessionClaimed = isOpenCodeSessionClaimed as Mock;
const mockIsProviderSessionClaimed = isProviderSessionClaimed as Mock;
const mockFetchAllOpenCodeSessions = fetchAllOpenCodeSessions as Mock;

// Helper to fire a fake SSE session.created.1 event via the internal handler.
// We expose a test-only hook by resetting and restarting the manager with a
// controlled fetch mock that immediately delivers the given events then hangs.
function makeSseResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  let idx = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (idx < events.length) {
        const frame = `data: ${JSON.stringify(events[idx++])}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }
      // Don't close — simulate a hanging connection (realistic SSE)
      await new Promise(() => {}); // never resolves
    },
  });
  return new Response(stream, { status: 200 });
}

describe('session-tree-manager', () => {
  beforeEach(() => {
    mockGetAllRegisteredConnections.mockReset();
    mockUpsertRegisteredConnection.mockReset();
    mockIsOpenCodeSessionClaimed.mockReset();
    mockIsProviderSessionClaimed.mockReset();
    mockFetchAllOpenCodeSessions.mockReset();
    mockFetchAllOpenCodeSessions.mockResolvedValue([]);
    mockInjectOpenCodeMessage.mockReset();
    mockInjectOpenCodeMessage.mockResolvedValue({ ok: true });
  });

  // ─── Original tests ──────────────────────────────────────────────────────

  it('emits session-tree-updated with a snapshot derived from registered connections', async () => {
    const registeredConnections = [
      {
        connectionId: 'conn-1',
        channelName: 'Agent 1',
        projectName: 'proj',
        baseDirectory: '/repo/a',
        idFilePath: '/tmp/a.json',
        openCodeSessionId: 'ses_1',
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        connectionId: 'conn-2',
        channelName: 'Agent 2',
        projectName: 'proj',
        baseDirectory: '/repo/b',
        idFilePath: '/tmp/b.json',
        openCodeSessionId: 'ses_2',
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        connectionId: 'conn-3',
        channelName: 'Agent 3',
        projectName: 'proj',
        baseDirectory: '/repo/a',
        idFilePath: '/tmp/c.json',
        openCodeSessionId: null,
        parentSessionId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];
    mockGetAllRegisteredConnections.mockReturnValue(registeredConnections);

    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: { send },
    };

    await triggerSessionTreeUpdate(() => win as unknown as BrowserWindow);

    // The snapshot is emitted via IPC — verify the channel name is correct.
    expect(send).toHaveBeenCalledWith(
      'session-tree-updated',
      expect.any(Array),
    );
  });

  it('does not emit when the window is destroyed', async () => {
    mockGetAllRegisteredConnections.mockReturnValue([]);

    const send = vi.fn();
    const win = {
      isDestroyed: () => true,
      webContents: { send },
    };

    await triggerSessionTreeUpdate(() => win as unknown as BrowserWindow);

    expect(send).not.toHaveBeenCalled();
  });

  it('does not emit when getWindow returns null', async () => {
    mockGetAllRegisteredConnections.mockReturnValue([]);

    const send = vi.fn();

    await triggerSessionTreeUpdate(() => null);

    expect(send).not.toHaveBeenCalled();
  });

  // ─── Auto-register tests ─────────────────────────────────────────────────

  describe('auto-register sessions', () => {
    const OPENCODE_PORT = 4096;

    function makeWindow() {
      const send = vi.fn();
      const win = { isDestroyed: () => false, webContents: { send } };
      return win as unknown as BrowserWindow;
    }

    function startManager(
      win: BrowserWindow,
      fetchMock: Mock,
      autoRegisterSubagents = true,
    ) {
      global.fetch = fetchMock;
      mockGetAllRegisteredConnections.mockReturnValue([]);
      stopSessionTreeManager();
      startSessionTreeManager(
        () => win,
        () => OPENCODE_PORT,
        () => autoRegisterSubagents,
      );
    }

    it('calls upsertRegisteredConnection when session.created.1 fires for a child session', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const childEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'child-ses-001',
            info: {
              id: 'child-ses-001',
              parentID: 'root-ses-000',
              title: 'Sub Agent',
              directory: '/home/user/project',
              time: { created: 1000, updated: 1000 },
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([childEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpsertRegisteredConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          // Phase 1: sessionId used directly as connectionId (no auto- prefix)
          connectionId: 'child-ses-001',
          providerSessionId: 'child-ses-001',
        }),
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('calls upsertRegisteredConnection when session.created.1 fires for a root session (no parentID)', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const rootEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'root-ses-100',
            info: {
              id: 'root-ses-100',
              parentID: null,
              title: 'Root Agent',
              directory: '/home/user/project',
              time: { created: 2000, updated: 2000 },
            },
          },
        },
      };

      const fetchMock = vi.fn().mockResolvedValue(makeSseResponse([rootEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpsertRegisteredConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          // Phase 1: sessionId used directly as connectionId (no auto- prefix)
          connectionId: 'root-ses-100',
          providerSessionId: 'root-ses-100',
        }),
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('does NOT call autoRegister when the session is already claimed by another connection', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(true);

      const childEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'child-ses-200',
            info: {
              id: 'child-ses-200',
              parentID: 'root-ses-000',
              title: 'Already Registered',
              directory: '/home/user/project',
              time: { created: 3000, updated: 3000 },
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([childEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpsertRegisteredConnection).not.toHaveBeenCalled();

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('does NOT call autoRegister when autoRegisterSubagents is false', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const childEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'child-ses-300',
            info: {
              id: 'child-ses-300',
              parentID: 'root-ses-000',
              title: 'Disabled Sub Agent',
              directory: '/home/user/project',
              time: { created: 4000, updated: 4000 },
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([childEvent]));
      const win = makeWindow();
      startManager(win, fetchMock, false); // autoRegisterSubagents = false

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpsertRegisteredConnection).not.toHaveBeenCalled();

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('auto-registers sessions seeded from REST on startup', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      mockFetchAllOpenCodeSessions.mockResolvedValue([
        {
          id: 'rest-ses-001',
          parentID: null,
          title: 'Existing Root Agent',
          directory: '/home/user/project',
          time: { created: 5000, updated: 5000 },
        },
        {
          id: 'rest-ses-002',
          parentID: 'rest-ses-001',
          title: 'Existing Sub Agent',
          directory: '/home/user/project',
          time: { created: 5001, updated: 5001 },
        },
      ]);

      // SSE that hangs immediately (no events) — only REST seed fires
      const fetchMock = vi.fn().mockResolvedValue(makeSseResponse([]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpsertRegisteredConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          // Phase 1: sessionId used directly as connectionId (no auto- prefix)
          connectionId: 'rest-ses-001',
          providerSessionId: 'rest-ses-001',
        }),
      );
      expect(mockUpsertRegisteredConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'rest-ses-002',
          providerSessionId: 'rest-ses-002',
        }),
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('does NOT auto-register REST-seeded sessions when autoRegisterSubagents is false', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      mockFetchAllOpenCodeSessions.mockResolvedValue([
        {
          id: 'rest-ses-010',
          parentID: null,
          title: 'Root Agent',
          directory: '/home/user/project',
          time: { created: 6000, updated: 6000 },
        },
      ]);

      const fetchMock = vi.fn().mockResolvedValue(makeSseResponse([]));
      const win = makeWindow();
      startManager(win, fetchMock, false);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpsertRegisteredConnection).not.toHaveBeenCalled();

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('injects session ID message into child session context on session.created.1', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const childEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'child-ses-inject',
            info: {
              id: 'child-ses-inject',
              parentID: 'root-ses-000',
              title: 'Injection Test Agent',
              directory: '/home/user/project',
              time: { created: 7000, updated: 7000 },
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([childEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      // Must inject into the child session (not the parent)
      expect(mockInjectOpenCodeMessage).toHaveBeenCalledWith(
        'child-ses-inject',
        expect.stringContaining('child-ses-inject'),
        undefined,
        OPENCODE_PORT,
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('does NOT inject a message for root sessions (no parentID)', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const rootEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'root-ses-noinject',
            info: {
              id: 'root-ses-noinject',
              parentID: null,
              title: 'Root Agent',
              directory: '/home/user/project',
              time: { created: 8000, updated: 8000 },
            },
          },
        },
      };

      const fetchMock = vi.fn().mockResolvedValue(makeSseResponse([rootEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockInjectOpenCodeMessage).not.toHaveBeenCalled();

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });
  });
});
