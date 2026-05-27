import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import { resolveSessionRepositoryRoot } from './session-repository-root';

describe('resolveSessionRepositoryRoot', () => {
  it('uses the active node base directory when present', () => {
    const node = makeNode({ id: 'child', baseDirectory: '/repo' });
    expect(resolveSessionRepositoryRoot(node, new Map([[node.id, node]]))).toBe(
      '/repo',
    );
  });

  it('inherits the repository root from a parent session', () => {
    const parent = makeNode({
      id: 'parent',
      providerSessionId: 'ses_parent',
      baseDirectory: '/repo',
    });
    const child = makeNode({
      id: 'child',
      providerSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      baseDirectory: null,
      directory: 'Unknown',
    });

    expect(
      resolveSessionRepositoryRoot(
        child,
        new Map([
          [parent.id, parent],
          [child.id, child],
        ]),
      ),
    ).toBe('/repo');
  });

  it('inherits the repository root from a parent when the active map is keyed by connection id', () => {
    const parent = makeNode({
      id: 'conn_parent',
      providerSessionId: 'ses_parent',
      baseDirectory: '/repo',
    });
    const child = makeNode({
      id: 'conn_child',
      providerSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      baseDirectory: null,
      directory: 'Unknown',
    });

    expect(
      resolveSessionRepositoryRoot(
        child,
        new Map([
          [parent.id, parent],
          [child.id, child],
        ]),
      ),
    ).toBe('/repo');
  });
});

function makeNode(overrides: Partial<SessionNode>): SessionNode {
  return {
    id: overrides.id ?? 'node',
    providerSessionId: overrides.providerSessionId ?? 'ses_node',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: 'Session',
    directory: overrides.directory ?? '/repo',
    createdAt: Date.now(),
    depth: 0,
    connectionId: null,
    hasMcpChannel: true,
    isDirectConnection: false,
    providerType: 'opencode',
    prompt: null,
    activeSession: null,
    baseDirectory:
      'baseDirectory' in overrides ? overrides.baseDirectory! : '/repo',
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: null,
    sessionStatuses: [],
    pendingPermissions: [],
    pendingQuestions: [],
    vcsInfo: null,
  };
}
