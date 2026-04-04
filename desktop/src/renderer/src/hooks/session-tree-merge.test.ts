import { describe, it, expect } from 'vitest';
import {
  mergeSessionTreeSnapshot,
  partitionNodes,
  type SnapshotNode,
} from './session-tree-merge';
import type { SessionNode } from '../types';

// ---------------------------------------------------------------------------
// Helpers — create minimal valid SessionNode / SnapshotNode fixtures
// ---------------------------------------------------------------------------

function makeSessionNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    openCodeSessionId: 'ses_1',
    openCodeParentId: null,
    title: 'Test Session',
    directory: '/tmp',
    depth: 0,
    connectionId: null,
    hasMcpChannel: false,
    isDirectConnection: false,
    prompt: null,
    activeSession: null,
    channelMessages: [],
    unreadCount: 0,
    hasPendingPrompt: false,
    sessionChannel: null,
    sessionStatuses: [],
    baseDirectory: null,
    ...overrides,
  };
}

function makeDirectConnectionNode(
  connectionId: string,
  title = 'Agent Direct',
  overrides: Partial<SessionNode> = {},
): SessionNode {
  return makeSessionNode({
    id: connectionId,
    openCodeSessionId: null,
    openCodeParentId: null,
    title,
    connectionId,
    hasMcpChannel: true,
    isDirectConnection: true,
    sessionChannel: { sessionId: connectionId, label: title },
    ...overrides,
  });
}

function makeSnapshot(overrides: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    openCodeSessionId: 'ses_1',
    openCodeParentId: null,
    title: 'Test Session',
    directory: '/tmp',
    depth: 0,
    connectionId: null,
    agentName: null,
    hasMcpChannel: false,
    baseDirectory: null,
    registeredParentSessionId: null,
    ...overrides,
  };
}

// ===========================================================================
// mergeSessionTreeSnapshot
// ===========================================================================

describe('mergeSessionTreeSnapshot', () => {
  it('creates tree nodes from snapshot when prev is empty', () => {
    const prev = new Map<string, SessionNode>();
    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_a',
        title: 'Root Session',
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    expect(result.size).toBe(1);
    expect(result.has('ses_a')).toBe(true);
    const node = result.get('ses_a')!;
    expect(node.isDirectConnection).toBe(false);
    expect(node.title).toBe('Root Session');
  });

  it('preserves runtime state (messages, unread, prompt) from existing tree node', () => {
    const existingMessages = [
      {
        id: 'msg-1',
        kind: 'question' as const,
        text: 'Hello',
        timestamp: new Date(),
      },
    ];
    const prev = new Map<string, SessionNode>([
      [
        'ses_a',
        makeSessionNode({
          id: 'ses_a',
          openCodeSessionId: 'ses_a',
          channelMessages: existingMessages,
          unreadCount: 3,
          hasPendingPrompt: true,
        }),
      ],
    ]);
    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_a',
        title: 'Updated Title',
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);
    const node = result.get('ses_a')!;

    expect(node.title).toBe('Updated Title');
    expect(node.channelMessages).toBe(existingMessages);
    expect(node.unreadCount).toBe(3);
    expect(node.hasPendingPrompt).toBe(true);
  });

  it('absorbs a direct-connection node when snapshot claims its connectionId', () => {
    const directMessages = [
      {
        id: 'msg-dc',
        kind: 'outbound' as const,
        text: 'Queued message',
        timestamp: new Date(),
      },
    ];
    const prev = new Map<string, SessionNode>([
      [
        'conn-123',
        makeDirectConnectionNode('conn-123', 'Agent 7', {
          channelMessages: directMessages,
          unreadCount: 1,
        }),
      ],
    ]);

    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_main',
        connectionId: 'conn-123',
        agentName: 'Claude Code',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    // The tree node should exist under its openCodeSessionId
    expect(result.has('ses_main')).toBe(true);

    // The direct-connection node should be gone
    expect(result.has('conn-123')).toBe(false);

    // The tree node should have absorbed the direct-connection's runtime state
    const node = result.get('ses_main')!;
    expect(node.isDirectConnection).toBe(false);
    expect(node.channelMessages).toBe(directMessages);
    expect(node.unreadCount).toBe(1);
    expect(node.title).toBe('Claude Code');
  });

  it('preserves direct-connection nodes NOT claimed by any snapshot node', () => {
    const prev = new Map<string, SessionNode>([
      ['unrelated-conn', makeDirectConnectionNode('unrelated-conn', 'VS Code')],
    ]);

    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_a',
        connectionId: 'other-conn',
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    // The unrelated direct connection should still be there
    expect(result.has('unrelated-conn')).toBe(true);
    expect(result.get('unrelated-conn')!.isDirectConnection).toBe(true);

    // Plus the snapshot node
    expect(result.has('ses_a')).toBe(true);
  });

  it('removes nodes from prev that are not in the new snapshot (session gone)', () => {
    const prev = new Map<string, SessionNode>([
      [
        'ses_old',
        makeSessionNode({
          id: 'ses_old',
          openCodeSessionId: 'ses_old',
        }),
      ],
    ]);

    const snapshot = [
      makeSnapshot({ openCodeSessionId: 'ses_new', title: 'New Session' }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    expect(result.has('ses_old')).toBe(false);
    expect(result.has('ses_new')).toBe(true);
  });

  it('handles multiple snapshot nodes with parent-child relationships', () => {
    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_root',
        openCodeParentId: null,
        title: 'Root',
        depth: 0,
      }),
      makeSnapshot({
        openCodeSessionId: 'ses_child',
        openCodeParentId: 'ses_root',
        title: 'Subagent',
        depth: 1,
      }),
    ];

    const result = mergeSessionTreeSnapshot(new Map(), snapshot);

    expect(result.size).toBe(2);
    const root = result.get('ses_root')!;
    const child = result.get('ses_child')!;
    expect(root.openCodeParentId).toBeNull();
    expect(child.openCodeParentId).toBe('ses_root');
    expect(child.depth).toBe(1);
  });

  it('prefers agentName over title when both are present in snapshot', () => {
    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_1',
        title: 'OpenCode Title',
        agentName: 'Claude Code',
      }),
    ];

    const result = mergeSessionTreeSnapshot(new Map(), snapshot);
    expect(result.get('ses_1')!.title).toBe('Claude Code');
  });

  it('uses title when agentName is null', () => {
    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_1',
        title: 'Auto-generated Title',
        agentName: null,
      }),
    ];

    const result = mergeSessionTreeSnapshot(new Map(), snapshot);
    expect(result.get('ses_1')!.title).toBe('Auto-generated Title');
  });

  it('absorbs direct connection matched by map key (id === connectionId)', () => {
    // In this scenario the direct connection's map key equals the connectionId
    // and the snapshot references that connectionId.
    const prev = new Map<string, SessionNode>([
      [
        'conn-abc',
        makeDirectConnectionNode('conn-abc', 'Agent X', {
          unreadCount: 5,
        }),
      ],
    ]);

    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_x',
        connectionId: 'conn-abc',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    expect(result.has('conn-abc')).toBe(false);
    expect(result.has('ses_x')).toBe(true);
    expect(result.get('ses_x')!.unreadCount).toBe(5);
  });
});

// ===========================================================================
// partitionNodes
// ===========================================================================

describe('partitionNodes', () => {
  it('separates direct connections from tree nodes', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_1',
        makeSessionNode({
          id: 'ses_1',
          openCodeSessionId: 'ses_1',
        }),
      ],
      ['dc-1', makeDirectConnectionNode('dc-1', 'Direct Agent')],
    ]);

    const { openCodeTree, directConnections } = partitionNodes(nodes);

    expect(openCodeTree).toHaveLength(1);
    expect(openCodeTree[0].id).toBe('ses_1');
    expect(directConnections).toHaveLength(1);
    expect(directConnections[0].id).toBe('dc-1');
  });

  it('builds depth-first tree from parent-child nodes', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_root',
        makeSessionNode({
          id: 'ses_root',
          openCodeSessionId: 'ses_root',
          openCodeParentId: null,
          title: 'Root',
        }),
      ],
      [
        'ses_child_b',
        makeSessionNode({
          id: 'ses_child_b',
          openCodeSessionId: 'ses_child_b',
          openCodeParentId: 'ses_root',
          title: 'B Child',
        }),
      ],
      [
        'ses_child_a',
        makeSessionNode({
          id: 'ses_child_a',
          openCodeSessionId: 'ses_child_a',
          openCodeParentId: 'ses_root',
          title: 'A Child',
        }),
      ],
    ]);

    const { openCodeTree, directConnections } = partitionNodes(nodes);

    expect(directConnections).toHaveLength(0);
    expect(openCodeTree).toHaveLength(3);
    // Root first
    expect(openCodeTree[0].id).toBe('ses_root');
    expect(openCodeTree[0].depth).toBe(0);
    // Children sorted alphabetically
    expect(openCodeTree[1].id).toBe('ses_child_a');
    expect(openCodeTree[1].depth).toBe(1);
    expect(openCodeTree[2].id).toBe('ses_child_b');
    expect(openCodeTree[2].depth).toBe(1);
  });

  it('returns empty arrays when no nodes exist', () => {
    const { openCodeTree, directConnections } = partitionNodes(new Map());

    expect(openCodeTree).toHaveLength(0);
    expect(directConnections).toHaveLength(0);
  });

  it('after merge: absorbed direct connection does NOT appear in directConnections', () => {
    // Simulate the full flow: direct connection exists, snapshot absorbs it
    const prev = new Map<string, SessionNode>([
      ['conn-1', makeDirectConnectionNode('conn-1', 'Agent 7')],
    ]);

    const snapshot = [
      makeSnapshot({
        openCodeSessionId: 'ses_main',
        openCodeParentId: null,
        connectionId: 'conn-1',
        agentName: 'Claude Code',
        hasMcpChannel: true,
      }),
    ];

    const merged = mergeSessionTreeSnapshot(prev, snapshot);
    const { openCodeTree, directConnections } = partitionNodes(merged);

    // Agent should appear under SESSIONS, not DIRECT CONNECTIONS
    expect(directConnections).toHaveLength(0);
    expect(openCodeTree).toHaveLength(1);
    expect(openCodeTree[0].title).toBe('Claude Code');
    expect(openCodeTree[0].isDirectConnection).toBe(false);
  });

  it('handles deep nesting (grandchild nodes)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_root',
        makeSessionNode({
          id: 'ses_root',
          openCodeSessionId: 'ses_root',
          openCodeParentId: null,
          title: 'Root',
        }),
      ],
      [
        'ses_child',
        makeSessionNode({
          id: 'ses_child',
          openCodeSessionId: 'ses_child',
          openCodeParentId: 'ses_root',
          title: 'Child',
        }),
      ],
      [
        'ses_grandchild',
        makeSessionNode({
          id: 'ses_grandchild',
          openCodeSessionId: 'ses_grandchild',
          openCodeParentId: 'ses_child',
          title: 'Grandchild',
        }),
      ],
    ]);

    const { openCodeTree } = partitionNodes(nodes);

    expect(openCodeTree).toHaveLength(3);
    expect(openCodeTree[0].depth).toBe(0);
    expect(openCodeTree[1].depth).toBe(1);
    expect(openCodeTree[2].depth).toBe(2);
  });
});
