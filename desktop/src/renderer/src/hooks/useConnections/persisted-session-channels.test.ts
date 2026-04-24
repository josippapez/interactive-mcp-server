import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import {
  hydratePersistedSessionChannels,
  type PersistedSessionChannel,
} from './persisted-session-channels';

function makeNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: overrides.id ?? 'ses_live',
    providerSessionId: overrides.providerSessionId ?? 'ses_live',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Live Session',
    directory: overrides.directory ?? '/tmp/project',
    createdAt: overrides.createdAt ?? Date.parse('2026-04-23T10:00:00.000Z'),
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? 'conn_live',
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
      sessionId: 'ses_live',
      label: 'Live Session',
    },
    sessionStatuses: overrides.sessionStatuses ?? [],
    pendingPermissions: overrides.pendingPermissions ?? [],
    pendingQuestions: overrides.pendingQuestions ?? [],
    vcsInfo: overrides.vcsInfo ?? null,
    docContextEnabled: overrides.docContextEnabled,
  };
}

describe('hydratePersistedSessionChannels', () => {
  it('adds persisted channels that are missing from the live session tree', () => {
    const prev = new Map<string, SessionNode>([['ses_live', makeNode()]]);

    const persisted: PersistedSessionChannel[] = [
      {
        sessionId: 'ses_live',
        label: 'Live Session',
        createdAt: '2026-04-23T10:00:00.000Z',
        providerSessionId: 'ses_live',
        parentSessionId: null,
      },
      {
        sessionId: 'ses_persisted',
        label: 'Persisted Session',
        createdAt: '2026-04-22T09:00:00.000Z',
        providerSessionId: null,
        parentSessionId: null,
      },
    ];

    const next = hydratePersistedSessionChannels(prev, persisted);

    expect(next.size).toBe(2);
    expect(next.get('ses_persisted')).toMatchObject({
      id: 'ses_persisted',
      providerSessionId: 'ses_persisted',
      title: 'Persisted Session',
      hasMcpChannel: true,
      isDirectConnection: false,
      sessionChannel: {
        sessionId: 'ses_persisted',
        label: 'Persisted Session',
      },
    });
  });

  it('preserves richer live node state when the persisted channel already exists', () => {
    const prev = new Map<string, SessionNode>([
      [
        'ses_live',
        makeNode({
          title: 'Live Title',
          prompt: {
            id: 'prompt_1',
            message: 'Continue?',
            projectName: 'interactive-mcp-server',
            connectionId: 'conn_live',
            connectionName: 'Agent',
            timeoutSeconds: 1200,
            expiresAt: 0,
            providerSessionId: 'ses_live',
          },
          hasPendingPrompt: true,
        }),
      ],
    ]);

    const persisted: PersistedSessionChannel[] = [
      {
        sessionId: 'ses_live',
        label: 'Persisted Label',
        createdAt: '2026-04-23T10:00:00.000Z',
        providerSessionId: 'ses_live',
        parentSessionId: null,
      },
    ];

    const next = hydratePersistedSessionChannels(prev, persisted);

    expect(next.get('ses_live')).toMatchObject({
      title: 'Live Title',
      hasPendingPrompt: true,
      sessionChannel: { sessionId: 'ses_live', label: 'Persisted Label' },
    });
  });
});
