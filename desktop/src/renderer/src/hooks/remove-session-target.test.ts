import { describe, expect, it } from 'vitest';
import {
  getRemoveSessionTarget,
  resolveSessionActionTarget,
} from './remove-session-target';

describe('resolveSessionActionTarget', () => {
  it('prefers the persisted session channel id for OpenCode-backed nodes', () => {
    expect(
      resolveSessionActionTarget({
        requestedId: 'ses_open_code',
        connectionId: 'conn-123',
        sessionChannelId: 'conn-123',
      }),
    ).toBe('conn-123');
  });

  it('falls back to the connection id when no session channel id is present', () => {
    expect(
      resolveSessionActionTarget({
        requestedId: 'ses_open_code',
        connectionId: 'conn-123',
      }),
    ).toBe('conn-123');
  });

  it('falls back to the requested id when node data is missing', () => {
    expect(
      resolveSessionActionTarget({
        requestedId: 'conn-123',
        connectionId: null,
        sessionChannelId: null,
      }),
    ).toBe('conn-123');
  });

  it('resolves a removal target from an OpenCode-backed session node', () => {
    expect(
      getRemoveSessionTarget(
        {
          id: 'ses_open_code',
          providerSessionId: 'ses_open_code',
          openCodeParentId: null,
          title: 'Claude Code',
          directory: '/repo',
          depth: 0,
          connectionId: 'conn-123',
          hasMcpChannel: true,
          isDirectConnection: false,
          providerType: 'opencode',
          prompt: null,
          activeSession: null,
          channelMessages: [],
          unreadCount: 0,
          lastReadMessageId: null,
          hasPendingPrompt: false,
          sessionChannel: { sessionId: 'conn-123', label: 'Claude Code' },
          sessionStatuses: [],
          baseDirectory: '/repo',
          pendingPermissions: [],
          vcsInfo: null,
        },
        'ses_open_code',
      ),
    ).toBe('conn-123');
  });
});
