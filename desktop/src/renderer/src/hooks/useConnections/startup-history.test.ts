import { describe, it, expect } from 'vitest';
import type { SessionNode } from '../../types';
import { resolveHistoryNodeKey } from './startup-history';

function makeNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    openCodeSessionId: null,
    openCodeParentId: null,
    title: 'Test',
    directory: '',
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
    pendingPermissions: [],
    baseDirectory: null,
    vcsInfo: null,
    ...overrides,
  };
}

describe('resolveHistoryNodeKey', () => {
  it('prefers direct node key match for openCode session IDs', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_child',
        makeNode({
          id: 'ses_child',
          openCodeSessionId: 'ses_child',
          connectionId: 'conn-shared',
        }),
      ],
      [
        'ses_parent',
        makeNode({
          id: 'ses_parent',
          openCodeSessionId: 'ses_parent',
          connectionId: 'conn-shared',
        }),
      ],
    ]);

    expect(resolveHistoryNodeKey(nodes, 'ses_child')).toBe('ses_child');
  });

  it('falls back to unique connectionId match for direct connections', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'conn_direct',
        makeNode({
          id: 'conn_direct',
          connectionId: 'conn_direct',
          isDirectConnection: true,
        }),
      ],
    ]);

    expect(resolveHistoryNodeKey(nodes, 'conn_direct')).toBe('conn_direct');
  });

  it('returns null when connectionId maps to multiple nodes', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_a',
        makeNode({
          id: 'ses_a',
          openCodeSessionId: 'ses_a',
          connectionId: 'conn-shared',
        }),
      ],
      [
        'ses_b',
        makeNode({
          id: 'ses_b',
          openCodeSessionId: 'ses_b',
          connectionId: 'conn-shared',
        }),
      ],
    ]);

    expect(resolveHistoryNodeKey(nodes, 'conn-shared')).toBeNull();
  });
});
