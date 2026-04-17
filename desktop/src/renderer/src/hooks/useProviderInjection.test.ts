import { describe, it, expect } from 'vitest';
import type { SessionNode } from '../types';
import { findNodeBySessionId } from './useProviderInjection';

/**
 * Minimal mock node for testing findNodeBySessionId.
 */
function mockNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    providerSessionId: null,
    openCodeParentId: null,
    title: 'Test Channel',
    directory: '/test',
    depth: 0,
    connectionId: 'conn-1',
    hasMcpChannel: true,
    isDirectConnection: false,
    providerType: null,
    prompt: null,
    activeSession: null,
    baseDirectory: null,
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: null,
    sessionStatuses: [],
    pendingPermissions: [],
    docContextEnabled: true,
    vcsInfo: null,
    ...overrides,
  };
}

describe('findNodeBySessionId', () => {
  it('returns null when nodes map is empty', () => {
    const nodes = new Map<string, SessionNode>();
    const result = findNodeBySessionId(nodes, 'any-session');

    expect(result).toEqual({ nodeKey: null, node: null });
  });

  it('finds node by matching connectionId', () => {
    const node = mockNode({ id: 'node-abc', connectionId: 'ses_target' });
    const nodes = new Map<string, SessionNode>([['node-abc', node]]);

    const result = findNodeBySessionId(nodes, 'ses_target');

    expect(result).toEqual({ nodeKey: 'node-abc', node });
  });

  it('finds node by matching node.id (direct connection)', () => {
    const node = mockNode({ id: 'ses_direct', connectionId: 'other' });
    const nodes = new Map<string, SessionNode>([['ses_direct', node]]);

    const result = findNodeBySessionId(nodes, 'ses_direct');

    expect(result).toEqual({ nodeKey: 'ses_direct', node });
  });

  it('returns first match when multiple nodes exist', () => {
    const node1 = mockNode({ id: 'node-1', connectionId: 'conn-1' });
    const node2 = mockNode({ id: 'node-2', connectionId: 'conn-2' });
    const nodes = new Map<string, SessionNode>([
      ['node-1', node1],
      ['node-2', node2],
    ]);

    const result = findNodeBySessionId(nodes, 'conn-2');

    expect(result).toEqual({ nodeKey: 'node-2', node: node2 });
  });

  it('returns null when no matching session is found', () => {
    const node = mockNode({ id: 'node-1', connectionId: 'conn-1' });
    const nodes = new Map<string, SessionNode>([['node-1', node]]);

    const result = findNodeBySessionId(nodes, 'unknown-session');

    expect(result).toEqual({ nodeKey: null, node: null });
  });

  it('prioritizes connectionId match over id match', () => {
    // node.id = 'ses_a' but connectionId = 'ses_b'
    // When we search for 'ses_a', it should match via node.id
    const node = mockNode({ id: 'ses_a', connectionId: 'ses_b' });
    const nodes = new Map<string, SessionNode>([['ses_a', node]]);

    // Search for ses_a (matches id)
    const resultA = findNodeBySessionId(nodes, 'ses_a');
    expect(resultA).toEqual({ nodeKey: 'ses_a', node });

    // Search for ses_b (matches connectionId)
    const resultB = findNodeBySessionId(nodes, 'ses_b');
    expect(resultB).toEqual({ nodeKey: 'ses_a', node });
  });

  it('prioritizes providerSessionId over connectionId for parent-child with shared connectionId', () => {
    // This test verifies the fix for the message routing bug where:
    // - Parent and child share the same connectionId (MCP transport UUID)
    // - They have different providerSessionId values
    // - findNodeBySessionId must return the correct node based on providerSessionId
    const sharedConnectionId = 'conn-shared-123';

    const parentNode = mockNode({
      id: 'ses_parent',
      providerSessionId: 'ses_parent',
      openCodeParentId: null,
      connectionId: sharedConnectionId,
    });

    const childNode = mockNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      connectionId: sharedConnectionId, // Same connectionId as parent!
    });

    const nodes = new Map<string, SessionNode>([
      ['ses_parent', parentNode],
      ['ses_child', childNode],
    ]);

    // Search by parent's providerSessionId should find parent
    const resultParent = findNodeBySessionId(nodes, 'ses_parent');
    expect(resultParent.nodeKey).toBe('ses_parent');
    expect(resultParent.node).toBe(parentNode);

    // Search by child's providerSessionId should find child
    const resultChild = findNodeBySessionId(nodes, 'ses_child');
    expect(resultChild.nodeKey).toBe('ses_child');
    expect(resultChild.node).toBe(childNode);
  });

  it('finds node by providerSessionId field even when map key differs', () => {
    // Node's map key might differ from its providerSessionId in some edge cases
    const node = mockNode({
      id: 'some-key',
      providerSessionId: 'ses_target',
      connectionId: 'other-conn',
    });
    const nodes = new Map<string, SessionNode>([['some-key', node]]);

    const result = findNodeBySessionId(nodes, 'ses_target');

    expect(result).toEqual({ nodeKey: 'some-key', node });
  });

  it('preserves distinct parent and child OpenCode sessions that share one connectionId', () => {
    const sharedConnectionId = 'conn-shared-456';

    const parentNode = mockNode({
      id: 'ses_parent',
      providerSessionId: 'ses_parent',
      openCodeParentId: null,
      connectionId: sharedConnectionId,
      providerType: 'opencode',
    });

    const childNode = mockNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      connectionId: sharedConnectionId,
      providerType: 'opencode',
    });

    const nodes = new Map<string, SessionNode>([
      ['ses_parent', parentNode],
      ['ses_child', childNode],
    ]);

    expect(findNodeBySessionId(nodes, 'ses_parent')).toEqual({
      nodeKey: 'ses_parent',
      node: parentNode,
    });
    expect(findNodeBySessionId(nodes, 'ses_child')).toEqual({
      nodeKey: 'ses_child',
      node: childNode,
    });
  });
});
