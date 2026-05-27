import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../../types';
import { filterVisibleSessionIds } from './sidebar-activity';

function createNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: overrides.id ?? 'session-1',
    providerSessionId: overrides.providerSessionId ?? 'session-1',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Session 1',
    directory: overrides.directory ?? '/tmp/project',
    createdAt: overrides.createdAt ?? Date.now(),
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? null,
    hasMcpChannel: overrides.hasMcpChannel ?? true,
    isDirectConnection: overrides.isDirectConnection ?? false,
    baseDirectory: overrides.baseDirectory ?? '/tmp/project',
    providerType: overrides.providerType ?? 'opencode',
    vcsInfo: overrides.vcsInfo ?? null,
    sessionChannel: overrides.sessionChannel ?? null,
    prompt: overrides.prompt ?? null,
    activeSession: overrides.activeSession ?? null,
    channelMessages: overrides.channelMessages ?? [],
    unreadCount: overrides.unreadCount ?? 0,
    lastReadMessageId: overrides.lastReadMessageId ?? null,
    hasPendingPrompt: overrides.hasPendingPrompt ?? false,
    sessionStatuses: overrides.sessionStatuses ?? [],
    pendingPermissions: overrides.pendingPermissions ?? [],
    pendingQuestions: overrides.pendingQuestions ?? [],
  };
}

describe('filterVisibleSessionIds', () => {
  it('hides inactive sessions without unread or pending work', () => {
    const idleNode = createNode();
    expect(filterVisibleSessionIds([idleNode], null)).toEqual([]);
  });

  it('keeps sessions with local working status visible', () => {
    const workingNode = createNode({
      sessionStatuses: [
        { type: 'working', status: 'Busy', timestamp: new Date() },
      ],
    });

    expect(filterVisibleSessionIds([workingNode], null)).toEqual(['session-1']);
  });

  it('keeps OpenCode sessions with busy provider status visible', () => {
    const childNode = createNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
      hasMcpChannel: false,
      openCodeParentId: 'ses_parent',
    });
    const parentNode = createNode({
      id: 'ses_parent',
      providerSessionId: 'ses_parent',
      hasMcpChannel: true,
    });

    expect(
      filterVisibleSessionIds([parentNode, childNode], null, (sessionId) =>
        sessionId === 'ses_child' ? 'busy' : null,
      ),
    ).toEqual(['ses_parent', 'ses_child']);
  });

  it('treats explicit idle provider status as authoritative over stale local working status', () => {
    const staleWorkingNode = createNode({
      sessionStatuses: [
        { status: 'Busy', type: 'working', timestamp: new Date() },
      ],
    });

    expect(
      filterVisibleSessionIds([staleWorkingNode], null, () => 'idle'),
    ).toEqual([]);
  });

  it('keeps pending questions visible even when provider status is idle', () => {
    const pendingNode = createNode({
      hasPendingPrompt: true,
    });

    expect(filterVisibleSessionIds([pendingNode], null, () => 'idle')).toEqual([
      'session-1',
    ]);
  });
});
