import { describe, it, expect } from 'vitest';
import type { SessionNode, SessionStatus } from '../../types';
import { dismissStatus } from './dismiss-status';

function makeStatus(timestamp: Date): SessionStatus {
  return {
    status: 'Working...',
    type: 'working',
    timestamp,
  };
}

function makeNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    providerSessionId: null,
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
    pendingQuestions: [],
    baseDirectory: null,
    vcsInfo: null,
    ...overrides,
  };
}

describe('dismissStatus', () => {
  it('returns same Map ref when no node matches', () => {
    const node = makeNode();
    const map = new Map([['node-1', node]]);
    expect(dismissStatus(map, 'unknown', new Date())).toBe(map);
  });

  it('removes status by direct node-key match', () => {
    const ts = new Date(1000);
    const node = makeNode({ sessionStatuses: [makeStatus(ts)] });
    const map = new Map([['node-1', node]]);

    const result = dismissStatus(map, 'node-1', ts);

    expect(result).not.toBe(map);
    expect(result.get('node-1')!.sessionStatuses).toEqual([]);
  });

  it('falls back to connectionId match for direct/standalone nodes', () => {
    const ts = new Date(1000);
    const node = makeNode({
      id: 'node-1',
      connectionId: 'conn-abc',
      isDirectConnection: true,
      providerSessionId: null,
      sessionStatuses: [makeStatus(ts)],
    });
    const map = new Map([['node-1', node]]);

    const result = dismissStatus(map, 'conn-abc', ts);

    expect(result.get('node-1')!.sessionStatuses).toEqual([]);
  });

  it('does NOT fall back to connectionId for OC-backed nodes (cross-channel routing safety)', () => {
    const ts = new Date(1000);
    const parent = makeNode({
      id: 'ses_parent',
      providerSessionId: 'ses_parent',
      connectionId: 'shared-conn',
      isDirectConnection: false,
      sessionStatuses: [makeStatus(ts)],
    });
    const child = makeNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
      connectionId: 'shared-conn',
      isDirectConnection: false,
      sessionStatuses: [makeStatus(ts)],
    });
    const map = new Map([
      ['ses_parent', parent],
      ['ses_child', child],
    ]);

    // Caller passes the shared connectionId — must NOT match either OC node.
    const result = dismissStatus(map, 'shared-conn', ts);

    expect(result).toBe(map);
    expect(result.get('ses_parent')!.sessionStatuses).toHaveLength(1);
    expect(result.get('ses_child')!.sessionStatuses).toHaveLength(1);
  });

  it('only removes status with matching timestamp', () => {
    const ts1 = new Date(1000);
    const ts2 = new Date(2000);
    const node = makeNode({
      sessionStatuses: [makeStatus(ts1), makeStatus(ts2)],
    });
    const map = new Map([['node-1', node]]);

    const result = dismissStatus(map, 'node-1', ts1);

    expect(result.get('node-1')!.sessionStatuses).toHaveLength(1);
    expect(result.get('node-1')!.sessionStatuses[0].timestamp).toBe(ts2);
  });
});
