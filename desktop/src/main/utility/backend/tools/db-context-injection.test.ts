import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { SkillOrInstruction } from '../database';
import {
  _getInjectedSessionsForTests,
  _resetInjectedSessionsForTests,
  clearDbContextInjected,
  decideShouldInjectDbContext,
  isDbContextInjected,
  markDbContextInjected,
  maybeInjectDbContextOnConnect,
} from './db-context-injection';

function makeEntry(
  overrides: Partial<SkillOrInstruction> = {},
): SkillOrInstruction {
  return {
    id: 1,
    name: 'entry-name',
    type: 'skill',
    description: 'entry description',
    content: 'entry content',
    category: null,
    tags: null,
    enabled: true,
    isBuiltin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    folderId: null,
    scope: 'global',
    ...overrides,
  };
}

describe('decideShouldInjectDbContext', () => {
  it('returns no-session-id when the session id is missing', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: undefined,
        alreadyInjected: new Set<string>(),
        enabledEntryCount: 1,
      }),
    ).toEqual({ shouldInject: false, reason: 'no-session-id' });
  });

  it('returns already-injected-this-process when the session was deduped', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_existing',
        alreadyInjected: new Set(['ses_existing']),
        enabledEntryCount: 1,
      }),
    ).toEqual({
      shouldInject: false,
      reason: 'already-injected-this-process',
    });
  });

  it('returns no-enabled-entries when nothing is effectively injectable', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_active',
        alreadyInjected: new Set<string>(),
        enabledEntryCount: 0,
      }),
    ).toEqual({ shouldInject: false, reason: 'no-enabled-entries' });
  });

  it('returns inject when the session has effective entries and is not deduped', () => {
    expect(
      decideShouldInjectDbContext({
        openCodeSessionId: 'ses_active',
        alreadyInjected: new Set<string>(),
        enabledEntryCount: 2,
      }),
    ).toEqual({ shouldInject: true, reason: 'inject' });
  });
});

describe('maybeInjectDbContextOnConnect', () => {
  beforeEach(() => {
    _resetInjectedSessionsForTests();
  });

  it('skips injection when muting globals and missing opt-ins remove all effective entries', () => {
    const buildMessage = vi.fn(() => 'unused');
    const startInjection = vi.fn();

    maybeInjectDbContextOnConnect({
      openCodeSessionId: 'ses_filtered',
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      baseDirectory: '/tmp/project',
      connectionId: 'conn-1',
      getOpenCodePort: () => 4096,
      _listEntries: () => [
        makeEntry({ name: 'muted-global', scope: 'global' }),
        makeEntry({ id: 2, name: 'session-only', scope: 'session-scoped' }),
      ],
      _listSessionOptIns: () => [],
      _listSessionMutes: () => ['muted-global'],
      _buildMessage: buildMessage,
      _startInjection: startInjection,
    });

    expect(buildMessage).not.toHaveBeenCalled();
    expect(startInjection).not.toHaveBeenCalled();
    expect(_getInjectedSessionsForTests().has('ses_filtered')).toBe(false);
  });

  it('passes session opt-ins and mutes to the builder and dedupes repeat connects', () => {
    const buildMessage = vi.fn(() => 'startup context');
    const startInjection = vi.fn();
    const options = {
      openCodeSessionId: 'ses_repeat',
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      baseDirectory: '/tmp/project',
      connectionId: 'conn-1',
      getOpenCodePort: () => 4096,
      _listEntries: () => [
        makeEntry({ name: 'global-visible', scope: 'global' }),
        makeEntry({ id: 2, name: 'session-opt-in', scope: 'session-scoped' }),
      ],
      _listSessionOptIns: () => ['session-opt-in'],
      _listSessionMutes: () => ['global-visible'],
      _buildMessage: buildMessage,
      _startInjection: startInjection,
    };

    maybeInjectDbContextOnConnect(options);
    maybeInjectDbContextOnConnect(options);

    expect(buildMessage).toHaveBeenCalledTimes(1);
    expect(buildMessage).toHaveBeenCalledWith({
      channelName: 'Test Agent',
      projectName: 'interactive-mcp-server',
      baseDirectory: '/tmp/project',
      openCodeSessionId: 'ses_repeat',
      entries: [
        makeEntry({ name: 'global-visible', scope: 'global' }),
        makeEntry({ id: 2, name: 'session-opt-in', scope: 'session-scoped' }),
      ],
      memories: [],
      sessionOptInNames: ['session-opt-in'],
      sessionMutedNames: ['global-visible'],
    });
    expect(startInjection).toHaveBeenCalledTimes(1);
    expect(startInjection).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        openCodeSessionId: 'ses_repeat',
        startupContextMessage: 'startup context',
      }),
    );
    expect(_getInjectedSessionsForTests().has('ses_repeat')).toBe(true);
  });
});

describe('isDbContextInjected', () => {
  beforeEach(() => {
    _resetInjectedSessionsForTests();
  });

  it('returns false for a never-marked session', () => {
    expect(isDbContextInjected('ses_unknown')).toBe(false);
  });

  it('returns true after markDbContextInjected', () => {
    markDbContextInjected('ses_marked');
    expect(isDbContextInjected('ses_marked')).toBe(true);
  });

  it('returns false after clearDbContextInjected', () => {
    markDbContextInjected('ses_compacted');
    clearDbContextInjected('ses_compacted');
    expect(isDbContextInjected('ses_compacted')).toBe(false);
  });

  it('returns false for empty input', () => {
    markDbContextInjected('ses_x');
    expect(isDbContextInjected('')).toBe(false);
  });
});
