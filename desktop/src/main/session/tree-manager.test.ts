import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('../database', () => ({
  getAllRegisteredConnections: vi.fn(),
  getRegisteredConnectionBySessionId: vi.fn(),
  updateConnectionOpenCodeSession: vi.fn(),
  upsertRegisteredConnection: vi.fn(),
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

vi.mock('../opencode/context-tracking', () => ({
  updateSessionTokens: vi.fn(() => ({
    sessionId: 'mock',
    totalTokens: 0,
    contextLimit: 128000,
    usableLimit: 108000,
    usagePercent: 0,
    isNearOverflow: false,
    isOverflow: false,
    updatedAt: Date.now(),
  })),
}));

import {
  refreshSessionTreeCache,
  triggerSessionTreeUpdate,
  startSessionTreeManager,
  stopSessionTreeManager,
} from './tree-manager';
import {
  getAllRegisteredConnections,
  getRegisteredConnectionBySessionId,
  upsertRegisteredConnection,
  isProviderSessionClaimed,
} from '../database';
import {
  fetchRootOpenCodeSessions,
  expandOpenCodeSessionTree,
  fetchOpenCodeSession,
  fetchAllOpenCodeSessions,
} from '../opencode/session';
import { injectOpenCodeMessage } from '../opencode/injector';
import { updateSessionTokens } from '../opencode/context-tracking';

const mockInjectOpenCodeMessage = injectOpenCodeMessage as Mock;
const mockUpdateSessionTokens = updateSessionTokens as Mock;
const mockGetAllRegisteredConnections = getAllRegisteredConnections as Mock;
const mockGetRegisteredConnectionBySessionId =
  getRegisteredConnectionBySessionId as Mock;
const mockUpsertRegisteredConnection = upsertRegisteredConnection as Mock;
const mockIsProviderSessionClaimed = isProviderSessionClaimed as Mock;
const mockFetchRootOpenCodeSessions = fetchRootOpenCodeSessions as Mock;
const mockExpandOpenCodeSessionTree = expandOpenCodeSessionTree as Mock;
const mockFetchOpenCodeSession = fetchOpenCodeSession as Mock;
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
    mockGetRegisteredConnectionBySessionId.mockReset();
    mockGetRegisteredConnectionBySessionId.mockReturnValue(null);
    mockUpsertRegisteredConnection.mockReset();
    mockIsProviderSessionClaimed.mockReset();
    mockFetchRootOpenCodeSessions.mockReset();
    mockFetchRootOpenCodeSessions.mockResolvedValue([]);
    mockExpandOpenCodeSessionTree.mockReset();
    mockExpandOpenCodeSessionTree.mockResolvedValue([]);
    mockFetchOpenCodeSession.mockReset();
    mockFetchOpenCodeSession.mockResolvedValue(null);
    mockFetchAllOpenCodeSessions.mockReset();
    mockFetchAllOpenCodeSessions.mockResolvedValue([]);
    mockInjectOpenCodeMessage.mockReset();
    mockInjectOpenCodeMessage.mockResolvedValue({ ok: true });
    mockUpdateSessionTokens.mockReset();
    mockUpdateSessionTokens.mockReturnValue({
      sessionId: 'mock',
      totalTokens: 0,
      contextLimit: 128000,
      usableLimit: 108000,
      usagePercent: 0,
      isNearOverflow: false,
      isOverflow: false,
      updatedAt: Date.now(),
    });
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

    it('emits only one session-tree snapshot for session.created.1 with auto-register enabled', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const childEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'child-ses-single-snapshot',
            info: {
              id: 'child-ses-single-snapshot',
              parentID: 'root-ses-000',
              title: 'Single Snapshot Agent',
              directory: '/home/user/project',
              time: { created: 1500, updated: 1500 },
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([childEvent]));
      const send = vi.fn();
      const win = {
        isDestroyed: () => false,
        webContents: { send },
      } as unknown as BrowserWindow;

      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 120));

      const snapshotCalls = send.mock.calls.filter(
        (call: unknown[]) => call[0] === 'session-tree-updated',
      );
      expect(snapshotCalls).toHaveLength(1);

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

    it('inherits parent baseDirectory when child session has fallback directory', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);
      // Mock parent registration lookup
      mockGetRegisteredConnectionBySessionId.mockImplementation(
        (sessionId: string) => {
          if (sessionId === 'root-ses-parent') {
            return {
              connectionId: 'root-ses-parent',
              providerSessionId: 'root-ses-parent',
              providerType: 'opencode',
              channelName: 'Parent Session',
              projectName: 'OpenCode',
              baseDirectory: '/home/user/actual-project',
              parentSessionId: null,
            };
          }
          return null;
        },
      );

      // Child session with home directory as fallback
      const childEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'child-ses-inherit',
            info: {
              id: 'child-ses-inherit',
              parentID: 'root-ses-parent',
              title: 'Child Agent',
              // This is a fallback directory that should be overridden
              directory: process.env['HOME'] ?? '/Users',
              time: { created: 9000, updated: 9000 },
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

      // Should use parent's baseDirectory instead of fallback
      expect(mockUpsertRegisteredConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'child-ses-inherit',
          providerSessionId: 'child-ses-inherit',
          baseDirectory: '/home/user/actual-project',
          parentSessionId: 'root-ses-parent',
        }),
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('re-seeds from REST on manual refresh even after startup seed completed', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);
      mockFetchAllOpenCodeSessions.mockResolvedValue([]);

      const fetchMock = vi.fn().mockResolvedValue(makeSseResponse([]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 50));

      mockFetchAllOpenCodeSessions.mockClear();

      await refreshSessionTreeCache();
      await refreshSessionTreeCache();

      expect(mockFetchAllOpenCodeSessions).toHaveBeenCalledTimes(2);

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('does not prune existing cached sessions when force refresh returns a partial list', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      // Initial startup seed returns two sessions (root + sibling)
      mockFetchAllOpenCodeSessions.mockResolvedValueOnce([
        {
          id: 'seed-a',
          parentID: null,
          title: 'Seed A',
          directory: '/repo',
          time: { created: 1000, updated: 1000 },
        },
        {
          id: 'seed-b',
          parentID: null,
          title: 'Seed B',
          directory: '/repo',
          time: { created: 1001, updated: 1001 },
        },
      ]);

      const send = vi.fn();
      const win = {
        isDestroyed: () => false,
        webContents: { send },
      } as unknown as BrowserWindow;
      const fetchMock = vi.fn().mockResolvedValue(makeSseResponse([]));
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 80));

      // Force refresh now returns only one session (partial/transient API view)
      mockFetchAllOpenCodeSessions.mockResolvedValueOnce([
        {
          id: 'seed-a',
          parentID: null,
          title: 'Seed A',
          directory: '/repo',
          time: { created: 1000, updated: 1000 },
        },
      ]);

      await refreshSessionTreeCache();
      await new Promise((r) => setTimeout(r, 80));

      const snapshotCalls = send.mock.calls.filter(
        (call: unknown[]) => call[0] === 'session-tree-updated',
      );
      expect(snapshotCalls.length).toBeGreaterThan(0);

      const latestSnapshot = snapshotCalls[snapshotCalls.length - 1]?.[1] as
        | Array<{ openCodeSessionId: string }>
        | undefined;
      const sessionIds = (latestSnapshot ?? []).map((s) => s.openCodeSessionId);

      // Keep prior cached sessions until authoritative session.deleted.1 arrives
      expect(sessionIds).toContain('seed-a');
      expect(sessionIds).toContain('seed-b');

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('builds snapshot title from OpenCode session title, not channelName fallback', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      // Registered row has a transport label that differs from OpenCode title.
      mockGetAllRegisteredConnections.mockReturnValue([
        {
          connectionId: 'ses_name_1',
          providerSessionId: 'ses_name_1',
          providerType: 'opencode',
          channelName: 'Claude Code',
          projectName: 'OpenCode',
          baseDirectory: '/repo',
          parentSessionId: null,
          idFilePath: '/tmp/id.json',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      const createdEvent = {
        payload: {
          type: 'session.created.1',
          aggregate: 'session',
          data: {
            sessionID: 'ses_name_1',
            info: {
              id: 'ses_name_1',
              parentID: null,
              title: 'OpenCode Canonical Name',
              directory: '/repo',
              time: { created: 1000, updated: 1000 },
            },
          },
        },
      };

      const send = vi.fn();
      const win = {
        isDestroyed: () => false,
        webContents: { send },
      } as unknown as BrowserWindow;

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([createdEvent]));
      global.fetch = fetchMock as unknown as typeof fetch;

      stopSessionTreeManager();
      startSessionTreeManager(
        () => win,
        () => OPENCODE_PORT,
      );

      await new Promise((r) => setTimeout(r, 80));

      const snapshotCall = send.mock.calls.find(
        (call: unknown[]) => call[0] === 'session-tree-updated',
      );
      expect(snapshotCall).toBeTruthy();

      const snapshot = snapshotCall?.[1] as Array<{
        openCodeSessionId: string;
        title: string;
      }>;
      const target = snapshot.find((s) => s.openCodeSessionId === 'ses_name_1');
      expect(target?.title).toBe('OpenCode Canonical Name');

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });
  });

  // ─── Context/token tracking via message.updated.1 ────────────────────────

  describe('context tracking from message.updated.1', () => {
    const OPENCODE_PORT = 4096;

    function makeWindow() {
      const send = vi.fn();
      const win = { isDestroyed: () => false, webContents: { send } };
      return win as unknown as BrowserWindow & {
        webContents: { send: Mock };
      };
    }

    function startManager(win: BrowserWindow, fetchMock: Mock) {
      global.fetch = fetchMock;
      mockGetAllRegisteredConnections.mockReturnValue([]);
      stopSessionTreeManager();
      startSessionTreeManager(
        () => win,
        () => OPENCODE_PORT,
      );
    }

    it('calls updateSessionTokens when message.updated.1 arrives for an assistant message', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);
      mockUpdateSessionTokens.mockReturnValue({
        sessionId: 'ses_ctx_1',
        totalTokens: 5000,
        contextLimit: 128000,
        usableLimit: 108000,
        usagePercent: 5,
        isNearOverflow: false,
        isOverflow: false,
        updatedAt: Date.now(),
      });

      const messageUpdatedEvent = {
        payload: {
          type: 'message.updated.1',
          aggregate: 'ses_ctx_1',
          data: {
            sessionID: 'ses_ctx_1',
            info: {
              id: 'msg_1',
              sessionID: 'ses_ctx_1',
              role: 'assistant',
              modelID: 'claude-3-opus',
              providerID: 'anthropic',
              tokens: {
                input: 3000,
                output: 1500,
                reasoning: 0,
                total: 5000,
                cache: { read: 0, write: 500 },
              },
              cost: 0.05,
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([messageUpdatedEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 100));

      // Should call updateSessionTokens with the token data, replace=true
      expect(mockUpdateSessionTokens).toHaveBeenCalledWith(
        'ses_ctx_1',
        {
          input: 3000,
          output: 1500,
          reasoning: 0,
          total: 5000,
          cache: { read: 0, write: 500 },
        },
        'claude-3-opus',
        'anthropic',
        true,
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('emits context-usage-updated IPC event after processing message.updated.1', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);
      mockUpdateSessionTokens.mockReturnValue({
        sessionId: 'ses_ctx_2',
        totalTokens: 50000,
        contextLimit: 200000,
        usableLimit: 180000,
        usagePercent: 28,
        isNearOverflow: false,
        isOverflow: false,
        updatedAt: Date.now(),
      });

      const messageUpdatedEvent = {
        payload: {
          type: 'message.updated.1',
          aggregate: 'ses_ctx_2',
          data: {
            sessionID: 'ses_ctx_2',
            info: {
              id: 'msg_2',
              sessionID: 'ses_ctx_2',
              role: 'assistant',
              modelID: 'claude-3-opus',
              providerID: 'anthropic',
              tokens: {
                input: 40000,
                output: 10000,
                reasoning: 0,
                total: 50000,
                cache: { read: 0, write: 0 },
              },
              cost: 0.25,
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([messageUpdatedEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 100));

      // Verify context-usage-updated IPC was sent
      const sendMock = (win as unknown as { webContents: { send: Mock } })
        .webContents.send;
      const usageCalls = sendMock.mock.calls.filter(
        (call: unknown[]) => call[0] === 'context-usage-updated',
      );
      expect(usageCalls.length).toBeGreaterThanOrEqual(1);
      expect(usageCalls[0][1]).toEqual(
        expect.objectContaining({
          sessionId: 'ses_ctx_2',
          totalTokens: 50000,
          usagePercent: 28,
        }),
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('ignores message.updated.1 for user messages (no tokens)', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const userMessageEvent = {
        payload: {
          type: 'message.updated.1',
          aggregate: 'ses_ctx_3',
          data: {
            sessionID: 'ses_ctx_3',
            info: {
              id: 'msg_user_1',
              sessionID: 'ses_ctx_3',
              role: 'user',
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([userMessageEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 100));

      expect(mockUpdateSessionTokens).not.toHaveBeenCalled();

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('passes modelID to updateSessionTokens for context limit lookup', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      const messageEvent = {
        payload: {
          type: 'message.updated.1',
          aggregate: 'ses_model_lim',
          data: {
            sessionID: 'ses_model_lim',
            info: {
              id: 'msg_lim_1',
              sessionID: 'ses_model_lim',
              role: 'assistant',
              modelID: 'claude-3-opus',
              providerID: 'anthropic',
              tokens: {
                input: 1000,
                output: 500,
                reasoning: 0,
                total: 1500,
                cache: { read: 0, write: 0 },
              },
              cost: 0.01,
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([messageEvent]));
      const win = makeWindow();
      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 100));

      // updateSessionTokens should have been called with the modelID
      expect(mockUpdateSessionTokens).toHaveBeenCalledWith(
        'ses_model_lim',
        expect.objectContaining({ total: 1500 }),
        'claude-3-opus',
        'anthropic',
        true,
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });

    it('hydrates Task-tool-spawned subagent via message.part.updated.1', async () => {
      mockIsProviderSessionClaimed.mockReturnValue(false);

      // fetchOpenCodeSession returns the child's full session info.
      mockFetchOpenCodeSession.mockResolvedValue({
        id: 'child-ses-task',
        parentID: 'root-ses-task-parent',
        title: 'Task Subagent',
        directory: '/home/user/project',
        time: { created: 12000, updated: 12000 },
      });

      const partUpdatedEvent = {
        payload: {
          type: 'message.part.updated.1',
          aggregate: 'root-ses-task-parent',
          data: {
            sessionID: 'root-ses-task-parent',
            part: {
              id: 'prt_task_1',
              messageID: 'msg_task_1',
              type: 'tool',
              tool: 'task',
              callID: 'call_task_1',
              state: {
                status: 'running',
                metadata: {
                  sessionId: 'child-ses-task',
                },
              },
            },
          },
        },
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValue(makeSseResponse([partUpdatedEvent]));
      const send = vi.fn();
      const win = {
        isDestroyed: () => false,
        webContents: { send },
      } as unknown as BrowserWindow;

      startManager(win, fetchMock);

      await new Promise((r) => setTimeout(r, 120));

      // fetchOpenCodeSession should have been called for the child.
      expect(mockFetchOpenCodeSession).toHaveBeenCalledWith(
        expect.any(Number),
        'child-ses-task',
      );

      // Should emit a session-tree-updated snapshot that includes the child.
      const snapshotCalls = send.mock.calls.filter(
        (call: unknown[]) => call[0] === 'session-tree-updated',
      );
      expect(snapshotCalls.length).toBeGreaterThan(0);

      // upsertRegisteredConnection should have been called for the child.
      expect(mockUpsertRegisteredConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSessionId: 'child-ses-task',
          connectionId: 'child-ses-task',
          parentSessionId: 'root-ses-task-parent',
        }),
      );

      stopSessionTreeManager();
      global.fetch = undefined as unknown as typeof fetch;
    });
  });
});
