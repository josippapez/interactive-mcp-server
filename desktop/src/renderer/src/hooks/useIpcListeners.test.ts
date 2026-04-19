import { describe, it, expect } from 'vitest';
import {
  collectDescendantKeys,
  findKeyByConnectionId,
  findPromptTargetKey,
} from './useIpcListeners';
import { resolveNewlyCreatedSessionNodeId } from './useIpcListeners/useSessionTreeHandler';
import type { SnapshotNode } from './session-tree-merge';
import type { SessionNode } from '../types';

function makeNode(
  id: string,
  providerSessionId: string | null,
  openCodeParentId: string | null,
  connectionId?: string | null,
): SessionNode {
  return {
    id,
    providerSessionId,
    openCodeParentId,
    title: id,
    directory: '',
    depth: 0,
    connectionId: connectionId ?? null,
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
    baseDirectory: null,
    pendingPermissions: [],
    pendingQuestions: [],
    vcsInfo: null,
  };
}

function makeSnapshotNode(overrides: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    providerSessionId: 'ses_new',
    openCodeParentId: null,
    title: 'OpenCode Session',
    directory: '/repo',
    depth: 0,
    connectionId: 'conn-new',
    channelName: 'Agent X',
    hasMcpChannel: true,
    baseDirectory: '/repo',
    registeredParentSessionId: null,
    providerType: 'opencode',
    vcsInfo: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findKeyByConnectionId
// ---------------------------------------------------------------------------

describe('findKeyByConnectionId', () => {
  it('returns the map key when providerSessionId matches an OC-backed node', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(findKeyByConnectionId(nodes, 'uuid-aaa', 'ses_root')).toBe(
      'ses_root',
    );
  });

  it('returns null when no node matches and no providerSessionId hint', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(findKeyByConnectionId(nodes, 'uuid-unknown')).toBeNull();
  });

  it('falls back to providerSessionId when connectionId does not match any node', () => {
    // Node is keyed by providerSessionId "ses_sub123" with a stale auto-connectionId.
    // The new UUID doesn't match any node's connectionId, but the
    // providerSessionId hint allows the fallback to find the correct node.
    const nodes = new Map([
      [
        'ses_sub123',
        makeNode('ses_sub123', 'ses_sub123', 'ses_root', 'auto-ses_sub123'),
      ],
    ]);
    expect(findKeyByConnectionId(nodes, 'uuid-new', 'ses_sub123')).toBe(
      'ses_sub123',
    );
  });

  it('prefers providerSessionId over connectionId when providerSessionId is provided', () => {
    // Two nodes: one with matching connectionId, another with matching providerSessionId key.
    // This simulates OpenCode's shared MCP client where multiple sessions share the same connectionId.
    // When the caller provides providerSessionId, that should take priority over connectionId.
    const nodes = new Map([
      ['ses_a', makeNode('ses_a', 'ses_a', null, 'uuid-shared')],
      ['ses_b', makeNode('ses_b', 'ses_b', null, 'uuid-shared')],
    ]);
    // providerSessionId hint wins when provided - routes to the correct subagent
    expect(findKeyByConnectionId(nodes, 'uuid-shared', 'ses_b')).toBe('ses_b');
  });

  it('returns null for an OpenCode-backed node when only connectionId is provided (prevents cross-channel routing)', () => {
    // OpenCode-backed nodes (providerSessionId !== null && !isDirectConnection)
    // refuse connectionId-only matching because multiple OC sessions share the
    // same MCP transport UUID. Callers MUST pass providerSessionId.
    const nodes = new Map([
      ['ses_a', makeNode('ses_a', 'ses_a', null, 'uuid-match')],
      ['ses_b', makeNode('ses_b', 'ses_b', null, 'auto-ses_b')],
    ]);
    expect(findKeyByConnectionId(nodes, 'uuid-match')).toBeNull();
    // With providerSessionId hint, it resolves correctly:
    expect(findKeyByConnectionId(nodes, 'uuid-match', 'ses_a')).toBe('ses_a');
  });

  it('returns null when providerSessionId hint has no corresponding node', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(
      findKeyByConnectionId(nodes, 'uuid-unknown', 'ses_nonexistent'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findPromptTargetKey
// ---------------------------------------------------------------------------

describe('findPromptTargetKey', () => {
  it('returns the map key when providerSessionId hint matches an OC-backed node', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(findPromptTargetKey(nodes, 'uuid-aaa', 'ses_root')).toBe('ses_root');
  });

  it('falls back to providerSessionId when connectionId is stale', () => {
    const nodes = new Map([
      ['ses_sub', makeNode('ses_sub', 'ses_sub', 'ses_root', 'auto-ses_sub')],
    ]);
    expect(findPromptTargetKey(nodes, 'uuid-new', 'ses_sub')).toBe('ses_sub');
  });

  it('returns null when neither connectionId nor providerSessionId matches', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(
      findPromptTargetKey(nodes, 'uuid-unknown', 'ses_nonexistent'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// collectDescendantKeys
// ---------------------------------------------------------------------------

describe('collectDescendantKeys', () => {
  it('returns an empty set when there are no children', () => {
    const nodes = new Map([['root', makeNode('root', 'ses_root', null)]]);
    expect(collectDescendantKeys(nodes, 'ses_root')).toEqual(new Set());
  });

  it('returns immediate children', () => {
    const nodes = new Map([
      ['root', makeNode('root', 'ses_root', null)],
      ['child1', makeNode('child1', 'ses_child1', 'ses_root')],
      ['child2', makeNode('child2', 'ses_child2', 'ses_root')],
    ]);
    expect(collectDescendantKeys(nodes, 'ses_root')).toEqual(
      new Set(['child1', 'child2']),
    );
  });

  it('returns grandchildren recursively', () => {
    const nodes = new Map([
      ['root', makeNode('root', 'ses_root', null)],
      ['child', makeNode('child', 'ses_child', 'ses_root')],
      ['grandchild', makeNode('grandchild', 'ses_grandchild', 'ses_child')],
    ]);
    expect(collectDescendantKeys(nodes, 'ses_root')).toEqual(
      new Set(['child', 'grandchild']),
    );
  });

  it('does not include nodes from a sibling subtree', () => {
    const nodes = new Map([
      ['root', makeNode('root', 'ses_root', null)],
      ['child', makeNode('child', 'ses_child', 'ses_root')],
      ['other_root', makeNode('other_root', 'ses_other', null)],
      ['other_child', makeNode('other_child', 'ses_other_child', 'ses_other')],
    ]);
    const result = collectDescendantKeys(nodes, 'ses_root');
    expect(result).toEqual(new Set(['child']));
    expect(result.has('other_root')).toBe(false);
    expect(result.has('other_child')).toBe(false);
  });

  it('does not include the root itself', () => {
    const nodes = new Map([
      ['root', makeNode('root', 'ses_root', null)],
      ['child', makeNode('child', 'ses_child', 'ses_root')],
    ]);
    expect(collectDescendantKeys(nodes, 'ses_root').has('root')).toBe(false);
  });
});

describe('resolveNewlyCreatedSessionNodeId', () => {
  it('returns a newly created OpenCode session node id', () => {
    const prev = new Map<string, { id: string }>([
      ['ses_existing', { id: 'ses_existing' }],
    ]);
    const snapshotNodes = [
      makeSnapshotNode({
        providerSessionId: 'ses_existing',
        connectionId: 'conn-existing',
      }),
      makeSnapshotNode({
        providerSessionId: 'ses_new',
        connectionId: 'conn-new',
      }),
    ];

    expect(resolveNewlyCreatedSessionNodeId(prev, snapshotNodes)).toMatchObject(
      {
        sessionId: 'ses_new',
        hasConnectedChannel: true,
      },
    );
  });

  it('returns null when snapshot only contains existing sessions', () => {
    const prev = new Map<string, { id: string }>([
      ['ses_existing', { id: 'ses_existing' }],
    ]);
    const snapshotNodes = [
      makeSnapshotNode({
        providerSessionId: 'ses_existing',
        connectionId: 'conn-existing',
      }),
    ];

    expect(resolveNewlyCreatedSessionNodeId(prev, snapshotNodes)).toBeNull();
  });

  it('returns null for sessions without MCP channel', () => {
    const prev = new Map<string, { id: string }>();
    const snapshotNodes = [
      makeSnapshotNode({
        providerSessionId: 'ses_unbound',
        connectionId: null,
        hasMcpChannel: false,
      }),
    ];

    expect(resolveNewlyCreatedSessionNodeId(prev, snapshotNodes)).toMatchObject(
      {
        sessionId: 'ses_unbound',
        hasConnectedChannel: false,
      },
    );
  });
});
