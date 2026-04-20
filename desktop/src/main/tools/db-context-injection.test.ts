import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _getInjectedSessionsForTests,
  _resetInjectedSessionsForTests,
  decideShouldInjectDbContext,
  markDbContextInjected,
  maybeInjectDbContextOnConnect,
} from './db-context-injection';
import type { SkillOrInstruction } from '../database';
import type { StartupContextParams } from './startup-context';

describe('decideShouldInjectDbContext', () => {
  it('skips when openCodeSessionId is missing', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: undefined,
        alreadyInjected: new Set(),
        enabledEntryCount: 3,
      }),
    ).toEqual({ shouldInject: false, reason: 'no-session-id' });

    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: null,
        alreadyInjected: new Set(),
        enabledEntryCount: 3,
      }),
    ).toEqual({ shouldInject: false, reason: 'no-session-id' });
  });

  it('skips when session was already injected this process', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_abc',
        alreadyInjected: new Set(['ses_abc']),
        enabledEntryCount: 3,
      }),
    ).toEqual({ shouldInject: false, reason: 'already-injected-this-process' });
  });

  it('skips when there are no enabled entries', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_abc',
        alreadyInjected: new Set(),
        enabledEntryCount: 0,
      }),
    ).toEqual({ shouldInject: false, reason: 'no-enabled-entries' });
  });

  it('injects when session is new and entries exist', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_abc',
        alreadyInjected: new Set(['ses_other']),
        enabledEntryCount: 1,
      }),
    ).toEqual({ shouldInject: true, reason: 'inject' });
  });
});

describe('markDbContextInjected', () => {
  beforeEach(() => {
    _resetInjectedSessionsForTests();
  });
  afterEach(() => {
    _resetInjectedSessionsForTests();
  });

  it('adds the session id to the shared dedupe set', () => {
    markDbContextInjected('ses_xyz');
    expect(_getInjectedSessionsForTests().has('ses_xyz')).toBe(true);
  });

  it('makes a subsequent decideShouldInjectDbContext skip the same session', () => {
    markDbContextInjected('ses_xyz');
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_xyz',
        alreadyInjected: _getInjectedSessionsForTests(),
        enabledEntryCount: 3,
      }),
    ).toEqual({ shouldInject: false, reason: 'already-injected-this-process' });
  });

  it('ignores empty session ids', () => {
    markDbContextInjected('');
    expect(_getInjectedSessionsForTests().size).toBe(0);
  });
});

describe('maybeInjectDbContextOnConnect', () => {
  beforeEach(() => {
    _resetInjectedSessionsForTests();
  });
  afterEach(() => {
    _resetInjectedSessionsForTests();
  });

  const baseEntry = (
    overrides: Partial<SkillOrInstruction>,
  ): SkillOrInstruction => ({
    id: 1,
    name: 'sk',
    type: 'instruction',
    description: 'desc',
    content: 'content',
    category: null,
    tags: null,
    enabled: true,
    isBuiltin: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    folderId: null,
    scope: 'global',
    ...overrides,
  });

  const baseOptions = () => ({
    openCodeSessionId: 'ses_abc',
    channelName: 'channel',
    projectName: 'proj',
    baseDirectory: '/tmp/proj',
    connectionId: 'conn_1',
    getWindow: () => null,
    getOpenCodePort: () => 4096,
  });

  it('fires injection when entries are enabled and session is new', () => {
    const start = vi.fn();
    const build = vi.fn(() => '<system-reminder>built</system-reminder>');
    const list = vi.fn(() => [baseEntry({ name: 'a' })]);

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: list,
      _buildMessage: build,
      _startInjection: start,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]?.startupContextMessage).toBe(
      '<system-reminder>built</system-reminder>',
    );
    expect(start.mock.calls[0]?.[0]?.openCodeSessionId).toBe('ses_abc');
    expect(start.mock.calls[0]?.[0]?.supportsProviderInjection).toBe(true);
    expect(_getInjectedSessionsForTests().has('ses_abc')).toBe(true);
  });

  it('does not fire twice for the same session in the same process', () => {
    const start = vi.fn();
    const list = vi.fn(() => [baseEntry({ name: 'a' })]);

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: list,
      _buildMessage: () => 'msg',
      _startInjection: start,
    });
    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: list,
      _buildMessage: () => 'msg',
      _startInjection: start,
    });

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('skips and does not record session when there are no enabled entries', () => {
    const start = vi.fn();

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [baseEntry({ enabled: false })],
      _buildMessage: () => 'msg',
      _startInjection: start,
    });

    expect(start).not.toHaveBeenCalled();
    expect(_getInjectedSessionsForTests().has('ses_abc')).toBe(false);
  });

  it('skips when openCodeSessionId is missing', () => {
    const start = vi.fn();

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      openCodeSessionId: undefined,
      _listEntries: () => [baseEntry({ name: 'a' })],
      _buildMessage: () => 'msg',
      _startInjection: start,
    });

    expect(start).not.toHaveBeenCalled();
  });

  it('rolls back the dedupe entry when the build step throws', () => {
    const start = vi.fn();

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [baseEntry({ name: 'a' })],
      _buildMessage: () => {
        throw new Error('build failed');
      },
      _startInjection: start,
    });

    expect(start).not.toHaveBeenCalled();
    expect(_getInjectedSessionsForTests().has('ses_abc')).toBe(false);
  });

  it('rolls back the dedupe entry when startInjection throws synchronously', () => {
    const start = vi.fn(() => {
      throw new Error('start failed');
    });

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [baseEntry({ name: 'a' })],
      _buildMessage: () => 'msg',
      _startInjection: start,
    });

    expect(_getInjectedSessionsForTests().has('ses_abc')).toBe(false);
  });

  it('does not throw when the entry list lookup fails', () => {
    const start = vi.fn();

    expect(() =>
      maybeInjectDbContextOnConnect({
        ...baseOptions(),
        _listEntries: () => {
          throw new Error('db down');
        },
        _buildMessage: () => 'msg',
        _startInjection: start,
      }),
    ).not.toThrow();
    expect(start).not.toHaveBeenCalled();
  });

  it('forwards session-scoped opt-in names to the message builder', () => {
    const start = vi.fn();
    const build = vi.fn<(p: StartupContextParams) => string>(() => 'msg');

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [
        baseEntry({ name: 'global-a', scope: 'global' }),
        baseEntry({ name: 'opt-b', scope: 'session-scoped' }),
      ],
      _listSessionOptIns: (providerType, sessionId) => {
        expect(providerType).toBe('opencode');
        expect(sessionId).toBe('ses_abc');
        return ['opt-b'];
      },
      _buildMessage: build,
      _startInjection: start,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0]?.sessionOptInNames).toEqual(['opt-b']);
  });

  it('skips injection when only session-scoped entries exist and nothing is opted in', () => {
    const start = vi.fn();
    const build = vi.fn(() => 'msg');

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [
        baseEntry({ name: 'opt-a', scope: 'session-scoped' }),
      ],
      _listSessionOptIns: () => [],
      _buildMessage: build,
      _startInjection: start,
    });

    expect(start).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(_getInjectedSessionsForTests().has('ses_abc')).toBe(false);
  });

  it('injects when only session-scoped entries exist but at least one is opted in', () => {
    const start = vi.fn();
    const build = vi.fn<(p: StartupContextParams) => string>(() => 'msg');

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [
        baseEntry({ name: 'opt-a', scope: 'session-scoped' }),
        baseEntry({ name: 'opt-b', scope: 'session-scoped' }),
      ],
      _listSessionOptIns: () => ['opt-a'],
      _buildMessage: build,
      _startInjection: start,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0]?.sessionOptInNames).toEqual(['opt-a']);
  });

  it('still injects when opt-in lookup throws (treats as empty list)', () => {
    const start = vi.fn();
    const build = vi.fn<(p: StartupContextParams) => string>(() => 'msg');

    maybeInjectDbContextOnConnect({
      ...baseOptions(),
      _listEntries: () => [baseEntry({ name: 'global-a', scope: 'global' })],
      _listSessionOptIns: () => {
        throw new Error('opt-in db read failed');
      },
      _buildMessage: build,
      _startInjection: start,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0]?.sessionOptInNames).toEqual([]);
  });
});
