import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import { resolvePermissionReplyDirectory } from './session-handlers';

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
    baseDirectory:
      'baseDirectory' in overrides ? overrides.baseDirectory! : '/tmp/project',
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

describe('resolvePermissionReplyDirectory', () => {
  it('keeps the permission event directory when present', () => {
    const nodes = new Map<string, SessionNode>([
      ['ses_existing', makeNode({ baseDirectory: '/repo' })],
    ]);

    expect(
      resolvePermissionReplyDirectory(nodes, 'ses_existing', '/event-dir'),
    ).toBe('/event-dir');
  });

  it('falls back to the session base directory when the permission omits one', () => {
    const nodes = new Map<string, SessionNode>([
      ['ses_existing', makeNode({ baseDirectory: '/repo' })],
    ]);

    expect(resolvePermissionReplyDirectory(nodes, 'ses_existing')).toBe(
      '/repo',
    );
  });

  it('falls back to the session directory when base directory is absent', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_existing',
        makeNode({ baseDirectory: null, directory: '/session-dir' }),
      ],
    ]);

    expect(resolvePermissionReplyDirectory(nodes, 'ses_existing')).toBe(
      '/session-dir',
    );
  });
});
