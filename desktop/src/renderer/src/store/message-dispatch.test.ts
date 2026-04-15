import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionNode, PromptData } from '../types';
import {
  resolvePromptTarget,
  resolveMessageTarget,
  resolveInteractiveMessageTarget,
  resolveTargetBySessionId,
  findNodeKeyWithFallback,
  type DispatchTarget,
} from './message-dispatch';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

function createMockNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'test-node-id',
    openCodeSessionId: null,
    openCodeParentId: null,
    title: 'Test Node',
    directory: '/test/dir',
    depth: 0,
    connectionId: null,
    hasMcpChannel: false,
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
    vcsInfo: null,
    ...overrides,
  };
}

function createMockPrompt(overrides: Partial<PromptData> = {}): PromptData {
  return {
    id: 'prompt-123',
    message: 'Test prompt',
    projectName: 'test-project',
    connectionId: 'conn-abc',
    connectionName: 'Test Connection',
    timeoutSeconds: 60,
    expiresAt: Date.now() + 60000,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// resolvePromptTarget
// -----------------------------------------------------------------------------

describe('resolvePromptTarget', () => {
  it('returns null when activeChannelId is null', () => {
    const nodes = new Map<string, SessionNode>();
    const result = resolvePromptTarget(nodes, null);
    expect(result).toBeNull();
  });

  it('returns null when node is not found', () => {
    const nodes = new Map<string, SessionNode>();
    const result = resolvePromptTarget(nodes, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('returns null when node has no prompt', () => {
    const node = createMockNode({ id: 'node-1' });
    const nodes = new Map([['node-1', node]]);
    const result = resolvePromptTarget(nodes, 'node-1');
    expect(result).toBeNull();
  });

  it('prioritizes prompt.openCodeSessionId over node.openCodeSessionId', () => {
    const prompt = createMockPrompt({
      openCodeSessionId: 'ses_prompt_session',
      connectionId: 'conn-shared',
    });
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: 'ses_node_session', // Different from prompt's
      connectionId: 'conn-shared',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_prompt_session');
    expect(result!.openCodeSessionId).toBe('ses_prompt_session');
    expect(result!.resolvedVia).toBe('prompt-session');
  });

  it('falls back to node.openCodeSessionId when prompt has no session ID', () => {
    const prompt = createMockPrompt({
      openCodeSessionId: null,
      connectionId: 'conn-abc',
    });
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: 'ses_node_session',
      connectionId: 'conn-abc',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_node_session');
    expect(result!.openCodeSessionId).toBe('ses_node_session');
    expect(result!.resolvedVia).toBe('node-session');
  });

  it('falls back to connectionId when no session IDs are available', () => {
    const prompt = createMockPrompt({
      openCodeSessionId: null,
      connectionId: 'conn-abc',
    });
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: null,
      connectionId: 'conn-abc',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('conn-abc');
    expect(result!.connectionId).toBe('conn-abc');
    expect(result!.openCodeSessionId).toBeNull();
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('uses prompt.connectionId when node.connectionId is null', () => {
    const prompt = createMockPrompt({
      openCodeSessionId: null,
      connectionId: 'conn-from-prompt',
    });
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: null,
      connectionId: null,
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('conn-from-prompt');
    expect(result!.connectionId).toBe('conn-from-prompt');
  });

  it('includes the full node in the result', () => {
    const prompt = createMockPrompt({ openCodeSessionId: 'ses_abc' });
    const node = createMockNode({
      id: 'node-1',
      title: 'My Test Node',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.node).toBe(node);
    expect(result!.node.title).toBe('My Test Node');
  });
});

// -----------------------------------------------------------------------------
// resolveMessageTarget
// -----------------------------------------------------------------------------

describe('resolveMessageTarget', () => {
  it('returns null when activeChannelId is null', () => {
    const nodes = new Map<string, SessionNode>();
    const result = resolveMessageTarget(nodes, null);
    expect(result).toBeNull();
  });

  it('returns null when node is not found', () => {
    const nodes = new Map<string, SessionNode>();
    const result = resolveMessageTarget(nodes, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('prioritizes openCodeSessionId for routing', () => {
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: 'ses_abc123',
      connectionId: 'conn-xyz',
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolveMessageTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_abc123');
    expect(result!.openCodeSessionId).toBe('ses_abc123');
    expect(result!.connectionId).toBe('conn-xyz');
    expect(result!.resolvedVia).toBe('node-session');
  });

  it('falls back to connectionId for direct connections', () => {
    const node = createMockNode({
      id: 'conn-direct',
      openCodeSessionId: null,
      connectionId: 'conn-direct',
      isDirectConnection: true,
    });
    const nodes = new Map([['conn-direct', node]]);

    const result = resolveMessageTarget(nodes, 'conn-direct');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('conn-direct');
    expect(result!.connectionId).toBe('conn-direct');
    expect(result!.openCodeSessionId).toBeNull();
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('falls back to node.id when no session or connection ID', () => {
    const node = createMockNode({
      id: 'fallback-id',
      openCodeSessionId: null,
      connectionId: null,
    });
    const nodes = new Map([['fallback-id', node]]);

    const result = resolveMessageTarget(nodes, 'fallback-id');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('fallback-id');
    expect(result!.connectionId).toBe('fallback-id');
    expect(result!.resolvedVia).toBe('active-channel');
  });

  it('does not require a prompt (unlike resolvePromptTarget)', () => {
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: 'ses_abc',
      prompt: null, // No prompt
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolveMessageTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_abc');
  });
});

// -----------------------------------------------------------------------------
// resolveTargetBySessionId
// -----------------------------------------------------------------------------

describe('resolveTargetBySessionId', () => {
  it('returns null when session ID is not found', () => {
    const nodes = new Map<string, SessionNode>();
    const result = resolveTargetBySessionId(nodes, 'non-existent');
    expect(result).toBeNull();
  });

  it('finds node by direct map key lookup', () => {
    const node = createMockNode({
      id: 'ses_abc123',
      openCodeSessionId: 'ses_abc123',
      connectionId: 'conn-xyz',
    });
    const nodes = new Map([['ses_abc123', node]]);

    const result = resolveTargetBySessionId(nodes, 'ses_abc123');

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_abc123');
    expect(result!.sessionId).toBe('ses_abc123');
  });

  it('finds node by openCodeSessionId field when key differs', () => {
    const node = createMockNode({
      id: 'different-key',
      openCodeSessionId: 'ses_target',
      connectionId: 'conn-xyz',
    });
    const nodes = new Map([['different-key', node]]);

    const result = resolveTargetBySessionId(nodes, 'ses_target');

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('different-key');
    expect(result!.sessionId).toBe('ses_target');
    expect(result!.resolvedVia).toBe('node-session');
  });

  it('finds node by connectionId field as fallback', () => {
    const node = createMockNode({
      id: 'node-key',
      openCodeSessionId: null,
      connectionId: 'conn-target',
    });
    const nodes = new Map([['node-key', node]]);

    const result = resolveTargetBySessionId(nodes, 'conn-target');

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('node-key');
    expect(result!.sessionId).toBe('conn-target');
    expect(result!.connectionId).toBe('conn-target');
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('prioritizes openCodeSessionId match over connectionId match', () => {
    // Node 1: has matching openCodeSessionId
    const node1 = createMockNode({
      id: 'node-1',
      openCodeSessionId: 'ses_target',
      connectionId: 'conn-other',
    });
    // Node 2: has matching connectionId
    const node2 = createMockNode({
      id: 'node-2',
      openCodeSessionId: null,
      connectionId: 'ses_target', // Same as node1's openCodeSessionId
    });
    const nodes = new Map([
      ['node-1', node1],
      ['node-2', node2],
    ]);

    const result = resolveTargetBySessionId(nodes, 'ses_target');

    expect(result).not.toBeNull();
    // Should find node-1 via openCodeSessionId, not node-2 via connectionId
    expect(result!.nodeKey).toBe('node-1');
    expect(result!.openCodeSessionId).toBe('ses_target');
  });
});

describe('resolveInteractiveMessageTarget', () => {
  it('prefers active channel target when requested session belongs to another channel', () => {
    const activeNode = createMockNode({
      id: 'ses_active',
      openCodeSessionId: 'ses_active',
      connectionId: 'conn_shared',
      title: 'Active',
    });
    const staleNode = createMockNode({
      id: 'ses_stale',
      openCodeSessionId: 'ses_stale',
      connectionId: 'conn_shared',
      title: 'Stale',
    });
    const nodes = new Map([
      ['ses_active', activeNode],
      ['ses_stale', staleNode],
    ]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      'ses_active',
      'ses_stale',
    );

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_active');
    expect(result!.sessionId).toBe('ses_active');
  });

  it('uses requested target when it matches active channel', () => {
    const node = createMockNode({
      id: 'ses_active',
      openCodeSessionId: 'ses_active',
      connectionId: 'conn_shared',
    });
    const nodes = new Map([['ses_active', node]]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      'ses_active',
      'ses_active',
    );

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_active');
    expect(result!.sessionId).toBe('ses_active');
  });

  it('falls back to requested target when no active channel exists', () => {
    const node = createMockNode({
      id: 'ses_requested',
      openCodeSessionId: 'ses_requested',
      connectionId: 'conn_requested',
    });
    const nodes = new Map([['ses_requested', node]]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      null,
      'ses_requested',
    );

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_requested');
    expect(result!.sessionId).toBe('ses_requested');
  });

  it('falls back to active channel target when requested session cannot be resolved', () => {
    const activeNode = createMockNode({
      id: 'ses_active',
      openCodeSessionId: 'ses_active',
      connectionId: 'conn_shared',
    });
    const nodes = new Map([['ses_active', activeNode]]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      'ses_active',
      'ses_missing',
    );

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_active');
    expect(result!.sessionId).toBe('ses_active');
  });

  it('returns null when active channel cannot be resolved', () => {
    const nodes = new Map<string, SessionNode>();

    const result = resolveInteractiveMessageTarget(
      nodes,
      'ses_missing_active',
      'ses_missing_requested',
    );

    expect(result).toBeNull();
  });

  it('uses requested target when active channel is missing but requested session resolves', () => {
    const activeNode = createMockNode({
      id: 'ses_active',
      openCodeSessionId: 'ses_active',
      connectionId: 'conn_shared',
    });
    const requestedNode = createMockNode({
      id: 'tree-node-key',
      openCodeSessionId: 'ses_requested',
      connectionId: 'conn_shared',
    });
    const nodes = new Map([
      ['ses_active', activeNode],
      ['tree-node-key', requestedNode],
    ]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      null,
      'ses_requested',
    );

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('tree-node-key');
    expect(result!.sessionId).toBe('ses_requested');
  });

  it('returns null when active channel is specified but cannot be resolved', () => {
    const requestedNode = createMockNode({
      id: 'ses_requested',
      openCodeSessionId: 'ses_requested',
      connectionId: 'conn_requested',
    });
    const nodes = new Map([['ses_requested', requestedNode]]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      'ses_missing_active',
      'ses_requested',
    );

    expect(result).toBeNull();
  });

  it('returns null when neither active nor requested target can be resolved', () => {
    const nodes = new Map<string, SessionNode>();

    const result = resolveInteractiveMessageTarget(
      nodes,
      null,
      'ses_requested',
    );

    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// findNodeKeyWithFallback
// -----------------------------------------------------------------------------

describe('findNodeKeyWithFallback', () => {
  it('returns primaryKey when it exists in map', () => {
    const node = createMockNode({ id: 'primary-key' });
    const nodes = new Map([['primary-key', node]]);

    const result = findNodeKeyWithFallback(
      nodes,
      'primary-key',
      'fallback-conn',
    );

    expect(result).toBe('primary-key');
  });

  it('returns null when primaryKey not found and no fallback', () => {
    const nodes = new Map<string, SessionNode>();

    const result = findNodeKeyWithFallback(nodes, 'missing-key', null);

    expect(result).toBeNull();
  });

  it('searches by connectionId when primaryKey not found', () => {
    const node = createMockNode({
      id: 'actual-key',
      connectionId: 'fallback-conn',
    });
    const nodes = new Map([['actual-key', node]]);

    const result = findNodeKeyWithFallback(
      nodes,
      'missing-key',
      'fallback-conn',
    );

    expect(result).toBe('actual-key');
  });

  it('handles node key changes (direct→tree absorption scenario)', () => {
    // Simulate: node was originally keyed by connectionId, then absorbed into
    // OpenCode tree and re-keyed by openCodeSessionId
    const node = createMockNode({
      id: 'ses_new_key', // New key after absorption
      openCodeSessionId: 'ses_new_key',
      connectionId: 'conn-original', // Original connectionId preserved
    });
    const nodes = new Map([['ses_new_key', node]]);

    // Caller still has the old key (connectionId)
    const result = findNodeKeyWithFallback(
      nodes,
      'conn-original',
      'conn-original',
    );

    expect(result).toBe('ses_new_key');
  });

  it('returns null when fallback connectionId also not found', () => {
    const node = createMockNode({
      id: 'some-key',
      connectionId: 'different-conn',
    });
    const nodes = new Map([['some-key', node]]);

    const result = findNodeKeyWithFallback(
      nodes,
      'missing-key',
      'also-missing-conn',
    );

    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Parent-Child Session Routing Scenarios
// -----------------------------------------------------------------------------

describe('Parent-Child Session Routing', () => {
  it('routes prompt response to correct child session (not parent)', () => {
    // Scenario: Parent and child share connectionId, but have different openCodeSessionIds
    const parentNode = createMockNode({
      id: 'ses_parent',
      openCodeSessionId: 'ses_parent',
      connectionId: 'conn-shared', // Shared with child
      prompt: null,
    });

    const childPrompt = createMockPrompt({
      openCodeSessionId: 'ses_child', // Child's session ID
      connectionId: 'conn-shared', // Same as parent
    });
    const childNode = createMockNode({
      id: 'ses_child',
      openCodeSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      connectionId: 'conn-shared', // Shared with parent
      prompt: childPrompt,
    });

    const nodes = new Map([
      ['ses_parent', parentNode],
      ['ses_child', childNode],
    ]);

    // User is viewing child channel and responds to prompt
    const result = resolvePromptTarget(nodes, 'ses_child');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_child'); // NOT ses_parent
    expect(result!.openCodeSessionId).toBe('ses_child');
    expect(result!.connectionId).toBe('conn-shared');
  });

  it('routes queued message to correct session even with shared connectionId', () => {
    const parentNode = createMockNode({
      id: 'ses_parent',
      openCodeSessionId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const childNode = createMockNode({
      id: 'ses_child',
      openCodeSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const nodes = new Map([
      ['ses_parent', parentNode],
      ['ses_child', childNode],
    ]);

    // Queue message specifically to child
    const result = resolveTargetBySessionId(nodes, 'ses_child');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_child');
    expect(result!.nodeKey).toBe('ses_child');
  });

  it('handles grandchild session routing correctly', () => {
    const parentNode = createMockNode({
      id: 'ses_parent',
      openCodeSessionId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const childNode = createMockNode({
      id: 'ses_child',
      openCodeSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const grandchildPrompt = createMockPrompt({
      openCodeSessionId: 'ses_grandchild',
      connectionId: 'conn-shared',
    });
    const grandchildNode = createMockNode({
      id: 'ses_grandchild',
      openCodeSessionId: 'ses_grandchild',
      openCodeParentId: 'ses_child',
      connectionId: 'conn-shared',
      prompt: grandchildPrompt,
    });

    const nodes = new Map([
      ['ses_parent', parentNode],
      ['ses_child', childNode],
      ['ses_grandchild', grandchildNode],
    ]);

    const result = resolvePromptTarget(nodes, 'ses_grandchild');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_grandchild');
    expect(result!.openCodeSessionId).toBe('ses_grandchild');
  });
});

// -----------------------------------------------------------------------------
// Edge Cases
// -----------------------------------------------------------------------------

describe('Edge Cases', () => {
  it('handles empty nodes map gracefully', () => {
    const nodes = new Map<string, SessionNode>();

    expect(resolvePromptTarget(nodes, 'any-id')).toBeNull();
    expect(resolveMessageTarget(nodes, 'any-id')).toBeNull();
    expect(resolveTargetBySessionId(nodes, 'any-id')).toBeNull();
    expect(findNodeKeyWithFallback(nodes, 'any-key', 'any-conn')).toBeNull();
  });

  it('handles node with all IDs being the same', () => {
    const node = createMockNode({
      id: 'same-id',
      openCodeSessionId: 'same-id',
      connectionId: 'same-id',
    });
    const nodes = new Map([['same-id', node]]);

    const result = resolveMessageTarget(nodes, 'same-id');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('same-id');
    expect(result!.nodeKey).toBe('same-id');
  });

  it('handles prompt with empty string openCodeSessionId', () => {
    const prompt = createMockPrompt({
      openCodeSessionId: '', // Empty string (falsy)
      connectionId: 'conn-abc',
    });
    const node = createMockNode({
      id: 'node-1',
      openCodeSessionId: 'ses_node',
      connectionId: 'conn-abc',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    // Empty string is falsy, so should fall back to node.openCodeSessionId
    expect(result!.sessionId).toBe('ses_node');
    expect(result!.resolvedVia).toBe('node-session');
  });
});
