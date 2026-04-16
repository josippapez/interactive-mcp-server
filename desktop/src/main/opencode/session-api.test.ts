import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientFactory, _setClientFactory } from './sdk-client';
import * as api from './session-api';

// ---------------------------------------------------------------------------
// Mock SDK client
// ---------------------------------------------------------------------------

type AnyFn = ReturnType<typeof vi.fn>;

interface MockSession {
  list: AnyFn;
  create: AnyFn;
  status: AnyFn;
  get: AnyFn;
  update: AnyFn;
  delete: AnyFn;
  children: AnyFn;
  todo: AnyFn;
  init: AnyFn;
  fork: AnyFn;
  abort: AnyFn;
  share: AnyFn;
  unshare: AnyFn;
  diff: AnyFn;
  summarize: AnyFn;
  messages: AnyFn;
  prompt: AnyFn;
  promptAsync: AnyFn;
  command: AnyFn;
  shell: AnyFn;
  revert: AnyFn;
  unrevert: AnyFn;
  message: AnyFn;
  deleteMessage: AnyFn;
}

let mockSession: MockSession;
let getClientSpy: ReturnType<typeof vi.fn>;

function makeResolved(tag: string) {
  return vi.fn().mockResolvedValue({
    data: { _tag: tag },
    error: null,
    response: { ok: true } as unknown as Response,
  });
}

beforeEach(() => {
  mockSession = {
    list: makeResolved('list'),
    create: makeResolved('create'),
    status: makeResolved('status'),
    get: makeResolved('get'),
    update: makeResolved('update'),
    delete: makeResolved('delete'),
    children: makeResolved('children'),
    todo: makeResolved('todo'),
    init: makeResolved('init'),
    fork: makeResolved('fork'),
    abort: makeResolved('abort'),
    share: makeResolved('share'),
    unshare: makeResolved('unshare'),
    diff: makeResolved('diff'),
    summarize: makeResolved('summarize'),
    messages: makeResolved('messages'),
    prompt: makeResolved('prompt'),
    promptAsync: makeResolved('promptAsync'),
    command: makeResolved('command'),
    shell: makeResolved('shell'),
    revert: makeResolved('revert'),
    unrevert: makeResolved('unrevert'),
    message: makeResolved('message'),
    deleteMessage: makeResolved('deleteMessage'),
  };
  const mockClient = { session: mockSession } as unknown as ReturnType<
    typeof import('./sdk-client').getClient
  >;
  getClientSpy = vi.fn().mockReturnValue(mockClient);
  _setClientFactory(
    getClientSpy as unknown as (
      port: number,
      directory?: string,
    ) => ReturnType<typeof import('./sdk-client').getClient>,
  );
});

afterEach(() => {
  _resetClientFactory();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PORT = 4096;
const SID = 'ses_xyz';
const MID = 'msg_abc';

function signal(): AbortSignal {
  return new AbortController().signal;
}

// ---------------------------------------------------------------------------
// sessionList
// ---------------------------------------------------------------------------

describe('sessionList', () => {
  it('calls session.list with no sessionID and hoisted query fields', async () => {
    await api.sessionList(PORT, { search: 'foo', limit: 10 });
    const call = mockSession.list.mock.calls[0];
    expect(call[0]).toEqual({ search: 'foo', limit: 10 });
    expect(call[0].sessionID).toBeUndefined();
  });

  it('omits directory when not provided', async () => {
    await api.sessionList(PORT);
    const params = mockSession.list.mock.calls[0][0];
    expect('directory' in params).toBe(false);
    expect(getClientSpy).toHaveBeenCalledWith(PORT, undefined);
  });

  it('forwards directory to getClient and parameters', async () => {
    await api.sessionList(PORT, undefined, { directory: '/repo' });
    expect(getClientSpy).toHaveBeenCalledWith(PORT, '/repo');
    expect(mockSession.list.mock.calls[0][0]).toEqual({ directory: '/repo' });
  });

  it('forwards signal as 2nd options arg', async () => {
    const s = signal();
    await api.sessionList(PORT, undefined, { signal: s });
    expect(mockSession.list.mock.calls[0][1]).toEqual({ signal: s });
  });

  it('returns raw SDK response', async () => {
    const res = await api.sessionList(PORT);
    expect(res).toEqual({
      data: { _tag: 'list' },
      error: null,
      response: { ok: true },
    });
  });
});

// ---------------------------------------------------------------------------
// sessionCreate
// ---------------------------------------------------------------------------

describe('sessionCreate', () => {
  it('hoists body fields flat into parameters (no nested body key)', async () => {
    await api.sessionCreate(PORT, { title: 'T', parentID: 'p1' });
    const params = mockSession.create.mock.calls[0][0];
    expect(params).toEqual({ title: 'T', parentID: 'p1' });
    expect('body' in params).toBe(false);
    expect(params.sessionID).toBeUndefined();
  });

  it('forwards directory to getClient and parameters', async () => {
    await api.sessionCreate(PORT, { title: 'T' }, { directory: '/d' });
    expect(getClientSpy).toHaveBeenCalledWith(PORT, '/d');
    expect(mockSession.create.mock.calls[0][0]).toEqual({
      title: 'T',
      directory: '/d',
    });
  });

  it('omits directory when not provided', async () => {
    await api.sessionCreate(PORT, { title: 'T' });
    expect('directory' in mockSession.create.mock.calls[0][0]).toBe(false);
  });

  it('forwards signal', async () => {
    const s = signal();
    await api.sessionCreate(PORT, undefined, { signal: s });
    expect(mockSession.create.mock.calls[0][1]).toEqual({ signal: s });
  });

  it('returns raw SDK response', async () => {
    const res = await api.sessionCreate(PORT);
    expect(res).toEqual({
      data: { _tag: 'create' },
      error: null,
      response: { ok: true },
    });
  });
});

// ---------------------------------------------------------------------------
// sessionStatus
// ---------------------------------------------------------------------------

describe('sessionStatus', () => {
  it('calls session.status with no sessionID', async () => {
    await api.sessionStatus(PORT);
    const params = mockSession.status.mock.calls[0][0];
    expect(params.sessionID).toBeUndefined();
  });

  it('forwards directory in first arg', async () => {
    await api.sessionStatus(PORT, { directory: '/d' });
    expect(mockSession.status.mock.calls[0][0]).toEqual({ directory: '/d' });
    expect(getClientSpy).toHaveBeenCalledWith(PORT, '/d');
  });

  it('forwards signal in second arg', async () => {
    const s = signal();
    await api.sessionStatus(PORT, { signal: s });
    expect(mockSession.status.mock.calls[0][1]).toEqual({ signal: s });
  });

  it('returns raw SDK response', async () => {
    const res = await api.sessionStatus(PORT);
    expect(res).toEqual({
      data: { _tag: 'status' },
      error: null,
      response: { ok: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Simple session-scoped methods (no body)
// ---------------------------------------------------------------------------

interface NoBodyCase {
  name: string;
  fn: (
    port: number,
    sessionID: string,
    opts?: api.SessionApiOpts,
  ) => Promise<unknown>;
  sdkKey: keyof MockSession;
}

const noBodyCases: NoBodyCase[] = [
  { name: 'sessionGet', fn: api.sessionGet, sdkKey: 'get' },
  { name: 'sessionChildren', fn: api.sessionChildren, sdkKey: 'children' },
  { name: 'sessionTodo', fn: api.sessionTodo, sdkKey: 'todo' },
  { name: 'sessionAbort', fn: api.sessionAbort, sdkKey: 'abort' },
  { name: 'sessionDelete', fn: api.sessionDelete, sdkKey: 'delete' },
  { name: 'sessionShare', fn: api.sessionShare, sdkKey: 'share' },
  { name: 'sessionUnshare', fn: api.sessionUnshare, sdkKey: 'unshare' },
  { name: 'sessionUnrevert', fn: api.sessionUnrevert, sdkKey: 'unrevert' },
];

for (const c of noBodyCases) {
  describe(c.name, () => {
    it('forwards sessionID', async () => {
      await c.fn(PORT, SID);
      expect(mockSession[c.sdkKey].mock.calls[0][0]).toEqual({
        sessionID: SID,
      });
    });

    it('omits directory when not provided', async () => {
      await c.fn(PORT, SID);
      const params = mockSession[c.sdkKey].mock.calls[0][0];
      expect('directory' in params).toBe(false);
      expect(getClientSpy).toHaveBeenCalledWith(PORT, undefined);
    });

    it('forwards directory', async () => {
      await c.fn(PORT, SID, { directory: '/d' });
      expect(mockSession[c.sdkKey].mock.calls[0][0]).toEqual({
        sessionID: SID,
        directory: '/d',
      });
      expect(getClientSpy).toHaveBeenCalledWith(PORT, '/d');
    });

    it('forwards signal', async () => {
      const s = signal();
      await c.fn(PORT, SID, { signal: s });
      expect(mockSession[c.sdkKey].mock.calls[0][1]).toEqual({ signal: s });
    });

    it('returns raw SDK response', async () => {
      const res = await c.fn(PORT, SID);
      expect(res).toEqual({
        data: { _tag: c.sdkKey },
        error: null,
        response: { ok: true },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Body-taking session-scoped methods (optional body)
// ---------------------------------------------------------------------------

interface BodyCase {
  name: string;
  fn: (
    port: number,
    sessionID: string,
    body: Record<string, unknown>,
    opts?: api.SessionApiOpts,
  ) => Promise<unknown>;
  sdkKey: keyof MockSession;
  body: Record<string, unknown>;
}

const bodyCases: BodyCase[] = [
  {
    name: 'sessionUpdate',
    fn: api.sessionUpdate as BodyCase['fn'],
    sdkKey: 'update',
    body: { title: 'new' },
  },
  {
    name: 'sessionFork',
    fn: api.sessionFork as BodyCase['fn'],
    sdkKey: 'fork',
    body: { messageID: MID },
  },
  {
    name: 'sessionDiff',
    fn: api.sessionDiff as BodyCase['fn'],
    sdkKey: 'diff',
    body: { messageID: MID },
  },
  {
    name: 'sessionInit',
    fn: api.sessionInit as BodyCase['fn'],
    sdkKey: 'init',
    body: { modelID: 'm', providerID: 'p' },
  },
  {
    name: 'sessionRevert',
    fn: api.sessionRevert as BodyCase['fn'],
    sdkKey: 'revert',
    body: { messageID: MID, partID: 'prt' },
  },
  {
    name: 'sessionSummarize',
    fn: api.sessionSummarize as BodyCase['fn'],
    sdkKey: 'summarize',
    body: { providerID: 'p', modelID: 'm', auto: true },
  },
  {
    name: 'sessionMessages',
    fn: api.sessionMessages as BodyCase['fn'],
    sdkKey: 'messages',
    body: { limit: 5, before: 'msg_1' },
  },
  {
    name: 'sessionPrompt',
    fn: api.sessionPrompt as BodyCase['fn'],
    sdkKey: 'prompt',
    body: { parts: [{ type: 'text', text: 'hi' }] },
  },
  {
    name: 'sessionPromptAsync',
    fn: api.sessionPromptAsync as BodyCase['fn'],
    sdkKey: 'promptAsync',
    body: { parts: [{ type: 'text', text: 'hi' }] },
  },
  {
    name: 'sessionCommand',
    fn: api.sessionCommand as BodyCase['fn'],
    sdkKey: 'command',
    body: { command: 'run', arguments: 'arg' },
  },
  {
    name: 'sessionShell',
    fn: api.sessionShell as BodyCase['fn'],
    sdkKey: 'shell',
    body: { command: 'ls' },
  },
];

for (const c of bodyCases) {
  describe(c.name, () => {
    it('forwards sessionID', async () => {
      await c.fn(PORT, SID, c.body);
      expect(mockSession[c.sdkKey].mock.calls[0][0].sessionID).toBe(SID);
    });

    it('hoists body fields flat into parameters (no nested body key)', async () => {
      await c.fn(PORT, SID, c.body);
      const params = mockSession[c.sdkKey].mock.calls[0][0];
      expect('body' in params).toBe(false);
      for (const [k, v] of Object.entries(c.body)) {
        expect(params[k]).toEqual(v);
      }
    });

    it('omits directory when not provided', async () => {
      await c.fn(PORT, SID, c.body);
      const params = mockSession[c.sdkKey].mock.calls[0][0];
      expect('directory' in params).toBe(false);
      expect(getClientSpy).toHaveBeenCalledWith(PORT, undefined);
    });

    it('forwards directory to getClient and parameters', async () => {
      await c.fn(PORT, SID, c.body, { directory: '/d' });
      const params = mockSession[c.sdkKey].mock.calls[0][0];
      expect(params.directory).toBe('/d');
      expect(getClientSpy).toHaveBeenCalledWith(PORT, '/d');
    });

    it('forwards signal as 2nd options arg', async () => {
      const s = signal();
      await c.fn(PORT, SID, c.body, { signal: s });
      expect(mockSession[c.sdkKey].mock.calls[0][1]).toEqual({ signal: s });
    });

    it('returns raw SDK response', async () => {
      const res = await c.fn(PORT, SID, c.body);
      expect(res).toEqual({
        data: { _tag: c.sdkKey },
        error: null,
        response: { ok: true },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Message-scoped methods (sessionID + messageID)
// ---------------------------------------------------------------------------

describe('sessionMessage', () => {
  it('forwards sessionID and messageID', async () => {
    await api.sessionMessage(PORT, SID, MID);
    expect(mockSession.message.mock.calls[0][0]).toEqual({
      sessionID: SID,
      messageID: MID,
    });
  });

  it('omits directory when not provided', async () => {
    await api.sessionMessage(PORT, SID, MID);
    expect('directory' in mockSession.message.mock.calls[0][0]).toBe(false);
  });

  it('forwards directory', async () => {
    await api.sessionMessage(PORT, SID, MID, { directory: '/d' });
    expect(mockSession.message.mock.calls[0][0]).toEqual({
      sessionID: SID,
      messageID: MID,
      directory: '/d',
    });
    expect(getClientSpy).toHaveBeenCalledWith(PORT, '/d');
  });

  it('forwards signal', async () => {
    const s = signal();
    await api.sessionMessage(PORT, SID, MID, { signal: s });
    expect(mockSession.message.mock.calls[0][1]).toEqual({ signal: s });
  });

  it('returns raw SDK response', async () => {
    const res = await api.sessionMessage(PORT, SID, MID);
    expect(res).toEqual({
      data: { _tag: 'message' },
      error: null,
      response: { ok: true },
    });
  });
});

describe('sessionDeleteMessage', () => {
  it('forwards sessionID and messageID', async () => {
    await api.sessionDeleteMessage(PORT, SID, MID);
    expect(mockSession.deleteMessage.mock.calls[0][0]).toEqual({
      sessionID: SID,
      messageID: MID,
    });
  });

  it('omits directory when not provided', async () => {
    await api.sessionDeleteMessage(PORT, SID, MID);
    expect('directory' in mockSession.deleteMessage.mock.calls[0][0]).toBe(
      false,
    );
  });

  it('forwards directory', async () => {
    await api.sessionDeleteMessage(PORT, SID, MID, { directory: '/d' });
    expect(mockSession.deleteMessage.mock.calls[0][0]).toEqual({
      sessionID: SID,
      messageID: MID,
      directory: '/d',
    });
    expect(getClientSpy).toHaveBeenCalledWith(PORT, '/d');
  });

  it('forwards signal', async () => {
    const s = signal();
    await api.sessionDeleteMessage(PORT, SID, MID, { signal: s });
    expect(mockSession.deleteMessage.mock.calls[0][1]).toEqual({ signal: s });
  });

  it('returns raw SDK response', async () => {
    const res = await api.sessionDeleteMessage(PORT, SID, MID);
    expect(res).toEqual({
      data: { _tag: 'deleteMessage' },
      error: null,
      response: { ok: true },
    });
  });
});
