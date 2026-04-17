import { describe, it, expect } from 'vitest';
import {
  buildSessionActions,
  filterActions,
  groupActions,
  type QuickSwitcherAction,
} from './QuickSwitcher.actions';
import type { SessionNode } from '../types';

// ---------------------------------------------------------------------------
// Helpers — create minimal valid SessionNode fixtures
// ---------------------------------------------------------------------------

function makeSessionNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    providerSessionId: 'ses_1',
    openCodeParentId: null,
    title: 'Test Session',
    directory: '/tmp',
    depth: 0,
    connectionId: null,
    hasMcpChannel: false,
    isDirectConnection: false,
    providerType: null,
    prompt: null,
    activeSession: null,
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: null,
    sessionStatuses: [],
    baseDirectory: null,
    pendingPermissions: [],
    pendingQuestions: [],
    vcsInfo: null,
    ...overrides,
  };
}

// ===========================================================================
// buildSessionActions
// ===========================================================================

describe('buildSessionActions', () => {
  it('creates actions from session nodes', () => {
    const connections = new Map<string, SessionNode>([
      ['ses_1', makeSessionNode({ id: 'ses_1', title: 'Claude Code' })],
      [
        'ses_2',
        makeSessionNode({
          id: 'ses_2',
          title: 'Research Agent',
          providerType: 'opencode',
        }),
      ],
    ]);

    const actions = buildSessionActions(connections);

    expect(actions).toHaveLength(2);
    expect(actions[0].id).toBe('session-ses_1');
    expect(actions[0].label).toBe('Claude Code');
    expect(actions[0].type).toBe('session');
    expect(actions[1].id).toBe('session-ses_2');
    expect(actions[1].providerType).toBe('opencode');
  });

  it('uses sessionChannel.label when available', () => {
    const connections = new Map<string, SessionNode>([
      [
        'ses_1',
        makeSessionNode({
          id: 'ses_1',
          title: 'Generic Title',
          sessionChannel: { sessionId: 'conn-1', label: 'Custom Label' },
        }),
      ],
    ]);

    const actions = buildSessionActions(connections);

    expect(actions[0].label).toBe('Custom Label');
  });

  it('includes directory as description', () => {
    const connections = new Map<string, SessionNode>([
      [
        'ses_1',
        makeSessionNode({
          id: 'ses_1',
          directory: '/Users/test/project',
        }),
      ],
    ]);

    const actions = buildSessionActions(connections);

    expect(actions[0].description).toBe('/Users/test/project');
  });

  it('preserves hasPendingPrompt flag', () => {
    const connections = new Map<string, SessionNode>([
      [
        'ses_1',
        makeSessionNode({
          id: 'ses_1',
          hasPendingPrompt: true,
        }),
      ],
      [
        'ses_2',
        makeSessionNode({
          id: 'ses_2',
          hasPendingPrompt: false,
        }),
      ],
    ]);

    const actions = buildSessionActions(connections);

    expect(actions[0].hasPendingPrompt).toBe(true);
    expect(actions[1].hasPendingPrompt).toBe(false);
  });

  it('returns empty array for empty connections', () => {
    const actions = buildSessionActions(new Map());
    expect(actions).toHaveLength(0);
  });

  it('uses provider-specific icons', () => {
    const connections = new Map<string, SessionNode>([
      ['ses_1', makeSessionNode({ id: 'ses_1', providerType: 'opencode' })],
      ['ses_2', makeSessionNode({ id: 'ses_2', providerType: 'copilot-cli' })],
      ['ses_3', makeSessionNode({ id: 'ses_3', providerType: 'claude-sdk' })],
    ]);

    const actions = buildSessionActions(connections);

    expect(actions[0].icon).toBe('⬡'); // opencode
    expect(actions[1].icon).toBe('◇'); // copilot-cli
    expect(actions[2].icon).toBe('◆'); // claude-sdk
  });
});

// ===========================================================================
// filterActions
// ===========================================================================

describe('filterActions', () => {
  const testActions: QuickSwitcherAction[] = [
    { id: '1', type: 'session', label: 'Claude Code' },
    {
      id: '2',
      type: 'session',
      label: 'Research Agent',
      description: 'Parallel research',
    },
    { id: '3', type: 'navigation', label: 'Go to Settings' },
    { id: '4', type: 'action', label: 'Refresh Sessions' },
  ];

  it('returns all actions when query is empty', () => {
    const result = filterActions(testActions, '');
    expect(result).toHaveLength(4);
  });

  it('returns all actions when query is only whitespace', () => {
    const result = filterActions(testActions, '   ');
    expect(result).toHaveLength(4);
  });

  it('filters by label (case insensitive)', () => {
    const result = filterActions(testActions, 'claude');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Claude Code');
  });

  it('filters by description (case insensitive)', () => {
    const result = filterActions(testActions, 'parallel');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Research Agent');
  });

  it('matches partial strings', () => {
    const result = filterActions(testActions, 'set');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Go to Settings');
  });

  it('returns empty array when no matches', () => {
    const result = filterActions(testActions, 'nonexistent');
    expect(result).toHaveLength(0);
  });

  it('matches multiple items', () => {
    const result = filterActions(testActions, 'es'); // matches Research, Settings, Sessions
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// groupActions
// ===========================================================================

describe('groupActions', () => {
  const testActions: QuickSwitcherAction[] = [
    { id: '1', type: 'session', label: 'Session A' },
    { id: '2', type: 'session', label: 'Session B' },
    { id: '3', type: 'navigation', label: 'Go to Settings' },
    { id: '4', type: 'action', label: 'Refresh' },
    { id: '5', type: 'action', label: 'New Skill' },
  ];

  it('groups actions by type', () => {
    const groups = groupActions(testActions);

    expect(groups.size).toBe(3);
    expect(groups.get('session')).toHaveLength(2);
    expect(groups.get('navigation')).toHaveLength(1);
    expect(groups.get('action')).toHaveLength(2);
  });

  it('preserves order within groups', () => {
    const groups = groupActions(testActions);

    const sessions = groups.get('session')!;
    expect(sessions[0].label).toBe('Session A');
    expect(sessions[1].label).toBe('Session B');
  });

  it('handles empty input', () => {
    const groups = groupActions([]);
    expect(groups.size).toBe(0);
  });

  it('handles single type', () => {
    const singleType: QuickSwitcherAction[] = [
      { id: '1', type: 'navigation', label: 'Nav 1' },
      { id: '2', type: 'navigation', label: 'Nav 2' },
    ];

    const groups = groupActions(singleType);

    expect(groups.size).toBe(1);
    expect(groups.get('navigation')).toHaveLength(2);
    expect(groups.get('session')).toBeUndefined();
    expect(groups.get('action')).toBeUndefined();
  });
});
