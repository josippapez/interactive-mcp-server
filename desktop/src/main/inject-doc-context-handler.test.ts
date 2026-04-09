import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleInjectDocContext,
  type InjectDocContextDeps,
} from './inject-doc-context-handler';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeDeps(
  overrides: Partial<InjectDocContextDeps> = {},
): InjectDocContextDeps {
  return {
    openCodePort: 8081,
    getRegisteredConnection: vi.fn(() => null),
    searchDocs: vi.fn().mockResolvedValue([]),
    injectOpenCodeMessage: vi
      .fn()
      .mockResolvedValue({ ok: true, noReply: true }),
    sendAgentMessage: vi.fn(),
    ...overrides,
  };
}

const BASE_INPUT = {
  connectionId: 'conn-123',
  openCodeSessionId: 'ses_abc',
  message: 'How do I set up routing?',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleInjectDocContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true with injectedCount:0 when no baseDirectory is available', async () => {
    const deps = makeDeps({
      getRegisteredConnection: vi.fn(() => null),
    });

    const result = await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: undefined },
      deps,
    );

    expect(result).toEqual({ ok: true, injectedCount: 0 });
    expect(deps.searchDocs).not.toHaveBeenCalled();
    expect(deps.injectOpenCodeMessage).not.toHaveBeenCalled();
  });

  it('falls back to DB baseDirectory when not supplied in input', async () => {
    const deps = makeDeps({
      getRegisteredConnection: vi.fn(() => ({
        connectionId: 'conn-123',
        channelName: 'Test Agent',
        projectName: 'my-project',
        baseDirectory: '/some/repo',
        idFilePath: '/tmp/agent.json',
        openCodeSessionId: null,
        parentSessionId: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      })),
      searchDocs: vi.fn().mockResolvedValue([]),
    });

    await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: undefined },
      deps,
    );

    expect(deps.getRegisteredConnection).toHaveBeenCalledWith('conn-123');
    expect(deps.searchDocs).toHaveBeenCalledWith(
      BASE_INPUT.message,
      '/some/repo',
      5,
    );
  });

  it('returns ok:true with injectedCount:0 when searchDocs returns no results', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([]),
    });

    const result = await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/some/repo' },
      deps,
    );

    expect(result).toEqual({ ok: true, injectedCount: 0 });
    expect(deps.injectOpenCodeMessage).not.toHaveBeenCalled();
  });

  it('calls searchDocs with the user message and baseDirectory', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([
        {
          path: 'docs/routing.md',
          score: 10,
          lineNumber: 1,
          snippet: 'routing setup',
        },
      ]),
    });

    await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    expect(deps.searchDocs).toHaveBeenCalledWith(
      'How do I set up routing?',
      '/my/repo',
      5,
    );
  });

  it('calls injectOpenCodeMessage with a system-reminder context snippet', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([
        {
          path: 'docs/routing.md',
          score: 10,
          lineNumber: 1,
          snippet: 'routing setup',
        },
      ]),
    });

    await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    expect(deps.injectOpenCodeMessage).toHaveBeenCalledWith(
      BASE_INPUT.openCodeSessionId,
      expect.stringContaining('<system-reminder>'),
      undefined,
      8081,
    );
    const [, messageText] = (
      deps.injectOpenCodeMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, string];
    expect(messageText).toContain('docs/routing.md');
    expect(messageText).toContain('</system-reminder>');
  });

  it('omits system-reminder tags when debug mode is enabled', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([
        {
          path: 'docs/routing.md',
          score: 10,
          lineNumber: 1,
          snippet: 'routing setup',
        },
      ]),
    });

    await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo', debug: true },
      deps,
    );

    const [, messageText] = (
      deps.injectOpenCodeMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, string];
    expect(messageText).toContain('docs/routing.md');
    expect(messageText).not.toContain('<system-reminder>');
    expect(messageText).not.toContain('</system-reminder>');
  });

  it('emits agent-message to the renderer (not persisted to DB)', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([
        {
          path: 'docs/routing.md',
          score: 10,
          lineNumber: 1,
          snippet: 'routing',
        },
        { path: 'docs/setup.md', score: 8, lineNumber: 2, snippet: 'setup' },
      ]),
    });

    const result = await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    expect(result).toEqual({ ok: true, injectedCount: 2 });

    expect(deps.sendAgentMessage).toHaveBeenCalledWith(
      'conn-123',
      expect.stringContaining('Context injected (2 docs)'),
    );
  });

  it('returns ok:false when injectOpenCodeMessage fails', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([
        {
          path: 'docs/routing.md',
          score: 10,
          lineNumber: 1,
          snippet: 'routing',
        },
      ]),
      injectOpenCodeMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: 'connection refused',
        noReply: true,
      }),
    });

    const result = await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.injectedCount).toBe(0);
    expect(result.error).toContain('doc context inject failed');
    expect(result.error).toContain('connection refused');
    expect(deps.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('returns ok:false when searchDocs throws', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockRejectedValue(new Error('disk read error')),
    });

    const result = await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.injectedCount).toBe(0);
    expect(result.error).toContain('searchDocs failed');
    expect(result.error).toContain('disk read error');
  });

  it('uses the supplied baseDirectory over the DB value', async () => {
    const deps = makeDeps({
      getRegisteredConnection: vi.fn(() => ({
        connectionId: 'conn-123',
        channelName: 'Agent',
        projectName: 'proj',
        baseDirectory: '/db/repo',
        idFilePath: '/tmp/a.json',
        openCodeSessionId: null,
        parentSessionId: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      })),
      searchDocs: vi.fn().mockResolvedValue([]),
    });

    await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/supplied/repo' },
      deps,
    );

    expect(deps.searchDocs).toHaveBeenCalledWith(
      BASE_INPUT.message,
      '/supplied/repo',
      5,
    );
    // Always checks DB for parentSessionId even when baseDirectory was supplied
    expect(deps.getRegisteredConnection).toHaveBeenCalledWith('conn-123');
  });

  it('skips injection for subagent sessions (parentSessionId set)', async () => {
    const deps = makeDeps({
      getRegisteredConnection: vi.fn(() => ({
        connectionId: 'conn-123',
        channelName: 'Subagent',
        projectName: 'proj',
        baseDirectory: '/my/repo',
        idFilePath: '/tmp/a.json',
        openCodeSessionId: 'ses_child',
        parentSessionId: 'ses_parent', // <-- this triggers the skip
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      })),
      searchDocs: vi
        .fn()
        .mockResolvedValue([
          { path: 'docs/api.md', score: 9, lineNumber: 0, snippet: '' },
        ]),
    });

    const result = await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    expect(result).toEqual({ ok: true, injectedCount: 0 });
    expect(deps.searchDocs).not.toHaveBeenCalled();
    expect(deps.injectOpenCodeMessage).not.toHaveBeenCalled();
    expect(deps.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('the visible summary lists each injected doc path', async () => {
    const deps = makeDeps({
      searchDocs: vi.fn().mockResolvedValue([
        { path: 'docs/api.md', score: 9, lineNumber: 0, snippet: '' },
        { path: 'docs/guide.md', score: 7, lineNumber: 0, snippet: '' },
      ]),
    });

    await handleInjectDocContext(
      { ...BASE_INPUT, baseDirectory: '/my/repo' },
      deps,
    );

    const mockCalls = (deps.sendAgentMessage as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, string]>;
    const [, messageText] = mockCalls[0];
    expect(messageText).toContain('`docs/api.md`');
    expect(messageText).toContain('`docs/guide.md`');
  });
});
