import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../types';
import {
  mergeSessionTreeSnapshot,
  type SnapshotNode,
} from './session-tree-merge';

function makeNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: overrides.id ?? 'ses_existing',
    providerSessionId: overrides.providerSessionId ?? 'ses_existing',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Existing Session',
    directory: overrides.directory ?? '/tmp/project',
    createdAt: overrides.createdAt ?? 1,
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? null,
    hasMcpChannel: overrides.hasMcpChannel ?? true,
    isDirectConnection: overrides.isDirectConnection ?? false,
    providerType: overrides.providerType ?? 'opencode',
    prompt: overrides.prompt ?? null,
    activeSession: overrides.activeSession ?? null,
    baseDirectory: overrides.baseDirectory ?? '/tmp/project',
    channelMessages: overrides.channelMessages ?? [],
    unreadCount: overrides.unreadCount ?? 0,
    lastReadMessageId: overrides.lastReadMessageId ?? null,
    hasPendingPrompt: overrides.hasPendingPrompt ?? false,
    sessionChannel: overrides.sessionChannel ?? {
      sessionId: overrides.id ?? 'ses_existing',
    },
    sessionStatuses: overrides.sessionStatuses ?? [],
    pendingPermissions: overrides.pendingPermissions ?? [],
    pendingQuestions: overrides.pendingQuestions ?? [],
    vcsInfo: overrides.vcsInfo ?? null,
    docContextEnabled: overrides.docContextEnabled,
  };
}

function makeSnapshotNode(overrides: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    providerSessionId: overrides.providerSessionId ?? 'ses_live',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Live Session',
    directory: overrides.directory ?? '/tmp/project',
    createdAt: overrides.createdAt ?? 2,
    updatedAt: overrides.updatedAt ?? 3,
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? 'conn_live',
    channelName: overrides.channelName ?? 'Live Session',
    hasMcpChannel: overrides.hasMcpChannel ?? true,
    baseDirectory: overrides.baseDirectory ?? '/tmp/project',
    registeredParentSessionId: overrides.registeredParentSessionId ?? null,
    providerType: overrides.providerType ?? 'opencode',
    vcsInfo: overrides.vcsInfo ?? null,
  };
}

describe('mergeSessionTreeSnapshot', () => {
  it('preserves persisted session-channel nodes missing from the live snapshot', () => {
    const prev = new Map<string, SessionNode>([
      [
        'ses_inactive',
        makeNode({
          id: 'ses_inactive',
          providerSessionId: 'ses_inactive',
          title: 'Inactive Session',
          connectionId: null,
        }),
      ],
      [
        'ses_live',
        makeNode({
          id: 'ses_live',
          providerSessionId: 'ses_live',
          title: 'Old Live Title',
          connectionId: 'conn_live',
        }),
      ],
    ]);

    const next = mergeSessionTreeSnapshot(prev, [
      makeSnapshotNode({
        providerSessionId: 'ses_live',
        title: 'Live Session',
      }),
    ]);

    expect(next.has('ses_inactive')).toBe(true);
    expect(next.get('ses_inactive')).toMatchObject({
      title: 'Inactive Session',
      sessionChannel: { sessionId: 'ses_inactive' },
    });
    expect(next.get('ses_live')?.title).toBe('Live Session');
  });
});
