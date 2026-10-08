import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import { resolveHistoryLoadId, resolveNodeHistoryLoadId } from './side-effects';

function sessionNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'ses_root',
    providerSessionId: 'ses_root',
    openCodeParentId: null,
    title: 'Root',
    directory: '/tmp/project',
    depth: 0,
    connectionId: 'conn_root',
    hasMcpChannel: true,
    isDirectConnection: false,
    providerType: 'opencode',
    prompt: null,
    activeSession: null,
    baseDirectory: '/tmp/project',
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: { sessionId: 'ses_root', label: 'Root' },
    sessionStatuses: [],
    pendingPermissions: [],
    pendingQuestions: [],
    docContextEnabled: true,
    vcsInfo: null,
    ...overrides,
  };
}

describe('side-effects history id helpers', () => {
  it('prefers provider session id, then session channel id, then connection id', () => {
    expect(resolveNodeHistoryLoadId(sessionNode())).toBe('ses_root');

    expect(
      resolveNodeHistoryLoadId(
        sessionNode({
          providerSessionId: null,
          sessionChannel: { sessionId: 'ses_channel', label: 'Child' },
        }),
      ),
    ).toBe('ses_channel');

    expect(
      resolveNodeHistoryLoadId(
        sessionNode({
          providerSessionId: null,
          sessionChannel: null,
          connectionId: 'conn_child',
        }),
      ),
    ).toBe('conn_child');
  });

  it('skips history ids that are already loaded', () => {
    const nodes = new Map<string, SessionNode>([['ses_root', sessionNode()]]);

    expect(resolveHistoryLoadId(nodes, 'ses_root', new Set())).toBe('ses_root');
    expect(resolveHistoryLoadId(nodes, 'ses_root', new Set(['ses_root']))).toBe(
      null,
    );
  });
});
