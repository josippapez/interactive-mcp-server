import { describe, expect, it } from 'vitest';
import type { SnapshotNode } from '../session-tree-merge';
import {
  resolveNewlyCreatedSessionNodeId,
  shouldAutoSelectNewSession,
} from './auto-select-decision';

function snap(overrides: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    providerSessionId: 'ses_a',
    openCodeParentId: null,
    title: 'A',
    directory: '/repo',
    depth: 0,
    connectionId: 'conn-a',
    channelName: 'Chan A',
    hasMcpChannel: true,
    baseDirectory: '/repo',
    registeredParentSessionId: null,
    providerType: 'opencode',
    vcsInfo: null,
    createdAt: 1000,
    ...overrides,
  };
}

describe('resolveNewlyCreatedSessionNodeId', () => {
  it('returns null when every snapshot node is already in prev', () => {
    const prev = new Map([['ses_a', { id: 'ses_a' }]]);
    expect(resolveNewlyCreatedSessionNodeId(prev, [snap()])).toBeNull();
  });

  it('picks the newest candidate by createdAt, not iteration order', () => {
    const prev = new Map<string, { id: string }>();
    const result = resolveNewlyCreatedSessionNodeId(prev, [
      snap({ providerSessionId: 'ses_old', createdAt: 1000 }),
      snap({ providerSessionId: 'ses_new', createdAt: 5000 }),
      snap({ providerSessionId: 'ses_mid', createdAt: 3000 }),
    ]);
    expect(result?.sessionId).toBe('ses_new');
    expect(result?.hasConnectedChannel).toBe(true);
  });

  it('skips nodes already in prev when scanning for newest', () => {
    const prev = new Map([['ses_new', { id: 'ses_new' }]]);
    const result = resolveNewlyCreatedSessionNodeId(prev, [
      snap({ providerSessionId: 'ses_old', createdAt: 1000 }),
      snap({ providerSessionId: 'ses_new', createdAt: 5000 }),
    ]);
    expect(result?.sessionId).toBe('ses_old');
  });

  it('reports hasConnectedChannel from the chosen candidate', () => {
    const prev = new Map<string, { id: string }>();
    const result = resolveNewlyCreatedSessionNodeId(prev, [
      snap({
        providerSessionId: 'ses_new',
        createdAt: 5000,
        hasMcpChannel: false,
      }),
    ]);
    expect(result?.hasConnectedChannel).toBe(false);
  });
});

describe('shouldAutoSelectNewSession', () => {
  const candidate = {
    sessionId: 'ses_x',
    hasConnectedChannel: true,
    createdAt: 1,
  };

  it('returns true when there is a connected candidate and nothing is active', () => {
    expect(
      shouldAutoSelectNewSession({
        candidate,
        activeChannelId: null,
        isIntentionalNullSelection: false,
      }),
    ).toBe(true);
  });

  it('returns false when no candidate', () => {
    expect(
      shouldAutoSelectNewSession({
        candidate: null,
        activeChannelId: null,
        isIntentionalNullSelection: false,
      }),
    ).toBe(false);
  });

  it('returns false when candidate has no MCP channel', () => {
    expect(
      shouldAutoSelectNewSession({
        candidate: { ...candidate, hasConnectedChannel: false },
        activeChannelId: null,
        isIntentionalNullSelection: false,
      }),
    ).toBe(false);
  });

  it('returns false when another channel is already active', () => {
    expect(
      shouldAutoSelectNewSession({
        candidate,
        activeChannelId: 'ses_other',
        isIntentionalNullSelection: false,
      }),
    ).toBe(false);
  });

  it('returns false when the user intentionally cleared the selection', () => {
    expect(
      shouldAutoSelectNewSession({
        candidate,
        activeChannelId: null,
        isIntentionalNullSelection: true,
      }),
    ).toBe(false);
  });
});
