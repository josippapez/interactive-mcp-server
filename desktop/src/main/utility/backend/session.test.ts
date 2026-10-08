import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionApiMocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionChildren: vi.fn(),
  sessionPromptAsync: vi.fn(),
  sessionUpdate: vi.fn(),
}));

vi.mock('./session-api', () => ({
  sessionChildren: sessionApiMocks.sessionChildren,
  sessionCreate: sessionApiMocks.sessionCreate,
  sessionPromptAsync: sessionApiMocks.sessionPromptAsync,
  sessionUpdate: sessionApiMocks.sessionUpdate,
}));

import { archiveOpenCodeSession, createOpenCodeSession } from './session';

const PORT = 4096;
const DIRECTORY = '/repo';

beforeEach(() => {
  sessionApiMocks.sessionCreate.mockReset();
  sessionApiMocks.sessionChildren.mockReset();
  sessionApiMocks.sessionPromptAsync.mockReset();
  sessionApiMocks.sessionUpdate.mockReset();
  sessionApiMocks.sessionCreate.mockResolvedValue({
    data: { id: 'ses_123', title: 'Created' },
    error: undefined,
  });
  sessionApiMocks.sessionPromptAsync.mockResolvedValue({
    data: undefined,
    error: undefined,
  });
  sessionApiMocks.sessionChildren.mockResolvedValue({
    data: [],
    error: undefined,
  });
  sessionApiMocks.sessionUpdate.mockResolvedValue({
    data: undefined,
    error: undefined,
  });
});

describe('createOpenCodeSession', () => {
  it('passes explicit agent and model to SDK session.create', async () => {
    await createOpenCodeSession(PORT, {
      title: 'New Chat',
      parentID: 'parent_1',
      directory: DIRECTORY,
      agent: 'plan',
      model: {
        id: 'gpt-5.5',
        providerID: 'github-copilot',
        variant: 'high',
      },
    });

    expect(sessionApiMocks.sessionCreate).toHaveBeenCalledWith(
      PORT,
      {
        title: 'New Chat',
        parentID: 'parent_1',
        agent: 'plan',
        model: {
          providerID: 'github-copilot',
          id: 'gpt-5.5',
          variant: 'high',
        },
      },
      expect.objectContaining({ directory: DIRECTORY }),
    );
  });

  it('passes provider-normalized reasoning variant to the initial prompt', async () => {
    await createOpenCodeSession(PORT, {
      initialMessage: 'Start work',
      directory: DIRECTORY,
      model: {
        id: 'gpt-5.5',
        providerID: 'github-copilot',
        variant: 'xhigh',
      },
    });

    expect(sessionApiMocks.sessionCreate).toHaveBeenCalledWith(
      PORT,
      {
        title: undefined,
        parentID: undefined,
        model: {
          providerID: 'github-copilot',
          id: 'gpt-5.5',
          variant: 'max',
        },
      },
      expect.objectContaining({ directory: DIRECTORY }),
    );
    expect(sessionApiMocks.sessionPromptAsync).toHaveBeenCalledWith(
      PORT,
      'ses_123',
      {
        parts: [{ type: 'text', text: 'Start work' }],
        model: {
          providerID: 'github-copilot',
          modelID: 'gpt-5.5',
        },
      },
      expect.objectContaining({ directory: DIRECTORY }),
    );
  });

  it('trims blank agent before session.create', async () => {
    await createOpenCodeSession(PORT, {
      title: 'New Chat',
      agent: '   ',
    });

    expect(sessionApiMocks.sessionCreate).toHaveBeenCalledWith(
      PORT,
      { title: 'New Chat', parentID: undefined },
      expect.any(Object),
    );
  });
});

describe('archiveOpenCodeSession', () => {
  it('archives child sessions before archiving the requested session', async () => {
    sessionApiMocks.sessionChildren.mockImplementation(
      async (_port: number, sessionID: string) => ({
        data:
          sessionID === 'ses_parent'
            ? [{ id: 'ses_child', directory: DIRECTORY }]
            : [],
        error: undefined,
      }),
    );

    await archiveOpenCodeSession(PORT, 'ses_parent', true);

    expect(sessionApiMocks.sessionUpdate).toHaveBeenNthCalledWith(
      1,
      PORT,
      'ses_child',
      { time: { archived: expect.any(Number) } },
      expect.objectContaining({ directory: DIRECTORY }),
    );
    expect(sessionApiMocks.sessionUpdate).toHaveBeenNthCalledWith(
      2,
      PORT,
      'ses_parent',
      { time: { archived: expect.any(Number) } },
      undefined,
    );
  });

  it('archives sibling child subtrees in parallel before archiving the requested session', async () => {
    const pendingChildUpdates = new Map<string, () => void>();
    sessionApiMocks.sessionChildren.mockImplementation(
      async (_port: number, sessionID: string) => ({
        data:
          sessionID === 'ses_parent'
            ? [
                { id: 'ses_child_1', directory: DIRECTORY },
                { id: 'ses_child_2', directory: DIRECTORY },
              ]
            : [],
        error: undefined,
      }),
    );
    sessionApiMocks.sessionUpdate.mockImplementation(
      async (_port: number, sessionID: string) => {
        if (sessionID === 'ses_child_1' || sessionID === 'ses_child_2') {
          await new Promise<void>((resolve) => {
            pendingChildUpdates.set(sessionID, resolve);
          });
        }
        return { data: {}, error: undefined };
      },
    );

    const archivePromise = archiveOpenCodeSession(PORT, 'ses_parent', true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(pendingChildUpdates.has('ses_child_1')).toBe(true);
    expect(pendingChildUpdates.has('ses_child_2')).toBe(true);
    expect(sessionApiMocks.sessionUpdate).not.toHaveBeenCalledWith(
      PORT,
      'ses_parent',
      expect.anything(),
      expect.anything(),
    );

    pendingChildUpdates.get('ses_child_1')?.();
    pendingChildUpdates.get('ses_child_2')?.();
    await expect(archivePromise).resolves.toBe(true);
    expect(sessionApiMocks.sessionUpdate).toHaveBeenLastCalledWith(
      PORT,
      'ses_parent',
      { time: { archived: expect.any(Number) } },
      undefined,
    );
  });
});
