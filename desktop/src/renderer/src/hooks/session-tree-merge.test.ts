import { describe, it, expect } from 'vitest';
import {
  mergeSessionTreeSnapshot,
  partitionNodes,
  groupByProject,
  upsertOptimisticSessionNode,
  type SnapshotNode,
} from './session-tree-merge';
import type { SessionNode } from '../types';

// ---------------------------------------------------------------------------
// Helpers — create minimal valid SessionNode / SnapshotNode fixtures
// ---------------------------------------------------------------------------

function makeSessionNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    providerSessionId: 'ses_1',
    openCodeParentId: null,
    title: 'Test Session',
    directory: '/tmp',
    createdAt: 0,
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
    baseDirectory: null,
    pendingPermissions: [],
    vcsInfo: null,
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
    providerSessionId: null,
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
    providerSessionId: 'ses_1',
    openCodeParentId: null,
    title: 'Test Session',
    directory: '/tmp',
    createdAt: 0,
    updatedAt: 0,
    depth: 0,
    connectionId: null,
    channelName: null,
    hasMcpChannel: false,
    baseDirectory: null,
    registeredParentSessionId: null,
    providerType: null,
    vcsInfo: null,
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
        providerSessionId: 'ses_a',
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
          providerSessionId: 'ses_a',
          channelMessages: existingMessages,
          unreadCount: 3,
          hasPendingPrompt: true,
        }),
      ],
    ]);
    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_a',
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
        providerSessionId: 'ses_main',
        connectionId: 'conn-123',
        channelName: 'Claude Code',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    // The tree node should exist under its providerSessionId
    expect(result.has('ses_main')).toBe(true);

    // The direct-connection node should be gone
    expect(result.has('conn-123')).toBe(false);

    // The tree node should have absorbed the direct-connection's runtime state
    const node = result.get('ses_main')!;
    expect(node.isDirectConnection).toBe(false);
    expect(node.channelMessages).toBe(directMessages);
    expect(node.unreadCount).toBe(1);
    expect(node.title).toBe('Test Session');
  });

  it("does NOT duplicate a direct-connection node's channelMessages across multiple OC sessions sharing the same connectionId", () => {
    // Repro: two OC sessions (parent + child subagent) share a single MCP
    // transport connectionId. A pre-existing direct-connection node (created
    // before the OC session-tree snapshot arrived) has live channelMessages.
    // The merge MUST absorb those messages into AT MOST ONE OC node — not
    // duplicate them into both. Prior bug: both OC nodes ended up with the
    // same channelMessages array, so messages from one channel showed up in
    // the chat history view of the sibling channel.
    const directMessages = [
      {
        id: 'msg-leak',
        kind: 'agent_message' as const,
        text: 'Originally for parent only',
        timestamp: new Date(),
      },
    ];
    const prev = new Map<string, SessionNode>([
      [
        'conn-shared',
        makeDirectConnectionNode('conn-shared', 'Claude Code', {
          channelMessages: directMessages,
        }),
      ],
    ]);

    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_parent',
        connectionId: 'conn-shared',
        channelName: 'Parent Session',
        hasMcpChannel: true,
      }),
      makeSnapshot({
        providerSessionId: 'ses_child',
        openCodeParentId: 'ses_parent',
        connectionId: 'conn-shared',
        channelName: 'Child Subagent',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    const parent = result.get('ses_parent')!;
    const child = result.get('ses_child')!;

    // The direct-connection's messages must NOT bleed into both OC nodes.
    // Exactly one of (parent, child) may inherit them; the other must start empty.
    const parentHasLeak = parent.channelMessages.some(
      (m) => m.id === 'msg-leak',
    );
    const childHasLeak = child.channelMessages.some((m) => m.id === 'msg-leak');
    expect(
      parentHasLeak && childHasLeak,
      'channelMessages from a shared connection were duplicated into BOTH OC sessions — this causes cross-channel messages to render in the wrong chat view',
    ).toBe(false);
  });

  it('preserves multiple pending permissions when absorbing a direct connection', () => {
    const prev = new Map<string, SessionNode>([
      [
        'conn-123',
        makeDirectConnectionNode('conn-123', 'Agent 7', {
          pendingPermissions: [
            {
              requestId: 'perm-1',
              sessionID: 'ses_main',
              permission: 'glob',
            },
            {
              requestId: 'perm-2',
              sessionID: 'ses_main',
              permission: 'read',
            },
          ],
        }),
      ],
    ]);

    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_main',
        connectionId: 'conn-123',
        channelName: 'Claude Code',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    expect(
      result.get('ses_main')?.pendingPermissions.map((item) => item.requestId),
    ).toEqual(['perm-1', 'perm-2']);
  });

  it('preserves direct-connection nodes NOT claimed by any snapshot node', () => {
    const prev = new Map<string, SessionNode>([
      ['unrelated-conn', makeDirectConnectionNode('unrelated-conn', 'VS Code')],
    ]);

    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_a',
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
          providerSessionId: 'ses_old',
        }),
      ],
    ]);

    const snapshot = [
      makeSnapshot({ providerSessionId: 'ses_new', title: 'New Session' }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    expect(result.has('ses_old')).toBe(false);
    expect(result.has('ses_new')).toBe(true);
  });

  it('handles multiple snapshot nodes with parent-child relationships', () => {
    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_root',
        openCodeParentId: null,
        title: 'Root',
        depth: 0,
      }),
      makeSnapshot({
        providerSessionId: 'ses_child',
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

  it('uses OpenCode title as authoritative label when both title and channelName are present', () => {
    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_1',
        title: 'OpenCode Title',
        channelName: 'Claude Code',
      }),
    ];

    const result = mergeSessionTreeSnapshot(new Map(), snapshot);
    expect(result.get('ses_1')!.title).toBe('OpenCode Title');
    expect(result.get('ses_1')!.sessionChannel?.label).toBe('OpenCode Title');
  });

  it('uses title when channelName is null', () => {
    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_1',
        title: 'Auto-generated Title',
        channelName: null,
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
        providerSessionId: 'ses_x',
        connectionId: 'conn-abc',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    expect(result.has('conn-abc')).toBe(false);
    expect(result.has('ses_x')).toBe(true);
    expect(result.get('ses_x')!.unreadCount).toBe(5);
  });

  it('assigns unique sessionChannel.sessionId using providerSessionId for parent and child with shared connectionId', () => {
    // This test verifies the fix for the message routing bug where parent-child
    // sessions share the same connectionId but need unique sessionChannel.sessionId
    // values for correct message routing.
    const prev = new Map<string, SessionNode>();

    // Parent and child both have the same connectionId (shared MCP transport)
    const sharedConnectionId = 'conn-shared-123';
    const snapshot = [
      makeSnapshot({
        providerSessionId: 'ses_parent',
        openCodeParentId: null,
        connectionId: sharedConnectionId,
        channelName: 'Parent Agent',
        hasMcpChannel: true,
      }),
      makeSnapshot({
        providerSessionId: 'ses_child',
        openCodeParentId: 'ses_parent',
        connectionId: sharedConnectionId, // Same connectionId as parent!
        channelName: 'Child Agent',
        hasMcpChannel: true,
      }),
    ];

    const result = mergeSessionTreeSnapshot(prev, snapshot);

    // Both nodes should exist
    expect(result.has('ses_parent')).toBe(true);
    expect(result.has('ses_child')).toBe(true);

    const parentNode = result.get('ses_parent')!;
    const childNode = result.get('ses_child')!;

    // CRITICAL: sessionChannel.sessionId must be unique for each session
    // (uses providerSessionId, not shared connectionId)
    expect(parentNode.sessionChannel?.sessionId).toBe('ses_parent');
    expect(childNode.sessionChannel?.sessionId).toBe('ses_child');

    // They should NOT have the same sessionChannel.sessionId
    expect(parentNode.sessionChannel?.sessionId).not.toBe(
      childNode.sessionChannel?.sessionId,
    );
  });

  it('reconciles an optimistic child node without creating a duplicate', () => {
    const optimistic = upsertOptimisticSessionNode(
      new Map(),
      makeSnapshot({
        providerSessionId: 'ses_child',
        openCodeParentId: 'ses_parent',
        title: 'Child Agent',
        connectionId: null,
        hasMcpChannel: false,
      }),
    );

    const reconciled = mergeSessionTreeSnapshot(optimistic, [
      makeSnapshot({
        providerSessionId: 'ses_child',
        openCodeParentId: 'ses_parent',
        title: 'Child Agent Final',
        connectionId: 'conn-child',
        hasMcpChannel: true,
      }),
    ]);

    expect(reconciled.size).toBe(1);
    expect(reconciled.has('ses_child')).toBe(true);
    expect(reconciled.get('ses_child')?.title).toBe('Child Agent Final');
    expect(reconciled.get('ses_child')?.connectionId).toBe('conn-child');
    expect(reconciled.get('ses_child')?.hasMcpChannel).toBe(true);
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
          providerSessionId: 'ses_1',
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
          providerSessionId: 'ses_root',
          openCodeParentId: null,
          title: 'Root',
        }),
      ],
      [
        'ses_child_b',
        makeSessionNode({
          id: 'ses_child_b',
          providerSessionId: 'ses_child_b',
          openCodeParentId: 'ses_root',
          title: 'B Child',
        }),
      ],
      [
        'ses_child_a',
        makeSessionNode({
          id: 'ses_child_a',
          providerSessionId: 'ses_child_a',
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
        providerSessionId: 'ses_main',
        openCodeParentId: null,
        connectionId: 'conn-1',
        channelName: 'Claude Code',
        hasMcpChannel: true,
      }),
    ];

    const merged = mergeSessionTreeSnapshot(prev, snapshot);
    const { openCodeTree, directConnections } = partitionNodes(merged);

    // Agent should appear under SESSIONS, not DIRECT CONNECTIONS
    expect(directConnections).toHaveLength(0);
    expect(openCodeTree).toHaveLength(1);
    expect(openCodeTree[0].title).toBe('Test Session');
    expect(openCodeTree[0].isDirectConnection).toBe(false);
  });

  it('handles deep nesting (grandchild nodes)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_root',
        makeSessionNode({
          id: 'ses_root',
          providerSessionId: 'ses_root',
          openCodeParentId: null,
          title: 'Root',
        }),
      ],
      [
        'ses_child',
        makeSessionNode({
          id: 'ses_child',
          providerSessionId: 'ses_child',
          openCodeParentId: 'ses_root',
          title: 'Child',
        }),
      ],
      [
        'ses_grandchild',
        makeSessionNode({
          id: 'ses_grandchild',
          providerSessionId: 'ses_grandchild',
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

  it('sorts roots by running subtrees first (child has pending prompt)', () => {
    const nodes = new Map<string, SessionNode>([
      // Root A - no activity
      [
        'ses_root_a',
        makeSessionNode({
          id: 'ses_root_a',
          providerSessionId: 'ses_root_a',
          openCodeParentId: null,
          title: 'Root A',
        }),
      ],
      // Root B - child has pending prompt (should be first)
      [
        'ses_root_b',
        makeSessionNode({
          id: 'ses_root_b',
          providerSessionId: 'ses_root_b',
          openCodeParentId: null,
          title: 'Root B',
        }),
      ],
      [
        'ses_child_b',
        makeSessionNode({
          id: 'ses_child_b',
          providerSessionId: 'ses_child_b',
          openCodeParentId: 'ses_root_b',
          title: 'Child B',
          hasPendingPrompt: true,
        }),
      ],
    ]);

    const { openCodeTree } = partitionNodes(nodes);

    // Root B should come first because its child has a pending prompt
    expect(openCodeTree[0].id).toBe('ses_root_b');
    expect(openCodeTree[1].id).toBe('ses_child_b');
    expect(openCodeTree[2].id).toBe('ses_root_a');
  });

  it('sorts roots by most recent subtree activity when no running sessions', () => {
    const oldTime = new Date(Date.now() - 60000); // 1 minute ago
    const newTime = new Date(Date.now()); // now

    const nodes = new Map<string, SessionNode>([
      // Root A - older activity
      [
        'ses_root_a',
        makeSessionNode({
          id: 'ses_root_a',
          providerSessionId: 'ses_root_a',
          openCodeParentId: null,
          title: 'Root A',
          channelMessages: [
            { id: 'msg-1', kind: 'outbound', text: 'old', timestamp: oldTime },
          ],
        }),
      ],
      // Root B - child has newer activity (should be first)
      [
        'ses_root_b',
        makeSessionNode({
          id: 'ses_root_b',
          providerSessionId: 'ses_root_b',
          openCodeParentId: null,
          title: 'Root B',
        }),
      ],
      [
        'ses_child_b',
        makeSessionNode({
          id: 'ses_child_b',
          providerSessionId: 'ses_child_b',
          openCodeParentId: 'ses_root_b',
          title: 'Child B',
          channelMessages: [
            { id: 'msg-2', kind: 'outbound', text: 'new', timestamp: newTime },
          ],
        }),
      ],
    ]);

    const { openCodeTree } = partitionNodes(nodes);

    // Root B should come first because its child has newer activity
    expect(openCodeTree[0].id).toBe('ses_root_b');
    expect(openCodeTree[1].id).toBe('ses_child_b');
    expect(openCodeTree[2].id).toBe('ses_root_a');
  });

  it('sorts roots by unread count in subtree when no running sessions', () => {
    const nodes = new Map<string, SessionNode>([
      // Root A - no unread
      [
        'ses_root_a',
        makeSessionNode({
          id: 'ses_root_a',
          providerSessionId: 'ses_root_a',
          openCodeParentId: null,
          title: 'Root A',
        }),
      ],
      // Root B - child has unread (should be first)
      [
        'ses_root_b',
        makeSessionNode({
          id: 'ses_root_b',
          providerSessionId: 'ses_root_b',
          openCodeParentId: null,
          title: 'Root B',
        }),
      ],
      [
        'ses_child_b',
        makeSessionNode({
          id: 'ses_child_b',
          providerSessionId: 'ses_child_b',
          openCodeParentId: 'ses_root_b',
          title: 'Child B',
          unreadCount: 3,
        }),
      ],
    ]);

    const { openCodeTree } = partitionNodes(nodes);

    // Root B should come first because its child has unread messages
    expect(openCodeTree[0].id).toBe('ses_root_b');
    expect(openCodeTree[1].id).toBe('ses_child_b');
    expect(openCodeTree[2].id).toBe('ses_root_a');
  });

  it('keeps children grouped with parents after sorting', () => {
    const newTime = new Date(Date.now());
    const oldTime = new Date(Date.now() - 60000);

    const nodes = new Map<string, SessionNode>([
      // Root A with child - older
      [
        'ses_root_a',
        makeSessionNode({
          id: 'ses_root_a',
          providerSessionId: 'ses_root_a',
          openCodeParentId: null,
          title: 'Root A',
          channelMessages: [
            { id: 'msg-1', kind: 'outbound', text: 'old', timestamp: oldTime },
          ],
        }),
      ],
      [
        'ses_child_a',
        makeSessionNode({
          id: 'ses_child_a',
          providerSessionId: 'ses_child_a',
          openCodeParentId: 'ses_root_a',
          title: 'Child A',
        }),
      ],
      // Root B with child - newer
      [
        'ses_root_b',
        makeSessionNode({
          id: 'ses_root_b',
          providerSessionId: 'ses_root_b',
          openCodeParentId: null,
          title: 'Root B',
          channelMessages: [
            { id: 'msg-2', kind: 'outbound', text: 'new', timestamp: newTime },
          ],
        }),
      ],
      [
        'ses_child_b',
        makeSessionNode({
          id: 'ses_child_b',
          providerSessionId: 'ses_child_b',
          openCodeParentId: 'ses_root_b',
          title: 'Child B',
        }),
      ],
    ]);

    const { openCodeTree } = partitionNodes(nodes);

    // Root B and its children first, then Root A and its children
    expect(openCodeTree.map((n) => n.id)).toEqual([
      'ses_root_b',
      'ses_child_b',
      'ses_root_a',
      'ses_child_a',
    ]);
  });
});

describe('groupByProject', () => {
  it('sorts projects by earliest session creation time (newer first)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_old',
        makeSessionNode({
          id: 'ses_old',
          providerSessionId: 'ses_old',
          openCodeParentId: null,
          baseDirectory: '/workspace/old',
          createdAt: 100,
        }),
      ],
      [
        'ses_new',
        makeSessionNode({
          id: 'ses_new',
          providerSessionId: 'ses_new',
          openCodeParentId: null,
          baseDirectory: '/workspace/new',
          createdAt: 200,
        }),
      ],
    ]);

    const projects = groupByProject(nodes);

    expect(projects[0].path).toBe('/workspace/new');
    expect(projects[1].path).toBe('/workspace/old');
  });
});
