import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionNode, PromptData } from '../types';
import {
  resolvePromptTarget,
  resolveMessageTarget,
  resolveInteractiveMessageTarget,
  resolveTargetBySessionId,
  type DispatchTarget,
} from './message-dispatch';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

function createMockNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'test-node-id',
    providerSessionId: null,
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
    pendingQuestions: [],
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

  it('uses node.providerSessionId (node is the authoritative target)', () => {
    const prompt = createMockPrompt({
      providerSessionId: 'ses_prompt_session',
      connectionId: 'conn-shared',
    });
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: 'ses_node_session', // Node identity wins
      connectionId: 'conn-shared',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_node_session');
    expect(result!.providerSessionId).toBe('ses_node_session');
    expect(result!.resolvedVia).toBe('prompt-session');
  });

  it('uses node.providerSessionId when prompt has no session ID', () => {
    const prompt = createMockPrompt({
      providerSessionId: null,
      connectionId: 'conn-abc',
    });
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: 'ses_node_session',
      connectionId: 'conn-abc',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_node_session');
    expect(result!.providerSessionId).toBe('ses_node_session');
    expect(result!.resolvedVia).toBe('prompt-session');
  });

  it('falls back to connectionId when no session IDs are available', () => {
    const prompt = createMockPrompt({
      providerSessionId: null,
      connectionId: 'conn-abc',
    });
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: null,
      connectionId: 'conn-abc',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('conn-abc');
    expect(result!.connectionId).toBe('conn-abc');
    expect(result!.providerSessionId).toBeNull();
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('uses nodeKey as connectionId when node.connectionId is null', () => {
    const prompt = createMockPrompt({
      providerSessionId: null,
      connectionId: 'conn-from-prompt',
    });
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: null,
      connectionId: null,
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    // Prompt payload's connectionId is ignored; falls back to nodeKey.
    expect(result!.sessionId).toBe('node-1');
    expect(result!.connectionId).toBe('node-1');
  });

  it('includes the full node in the result', () => {
    const prompt = createMockPrompt({ providerSessionId: 'ses_abc' });
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

  it('prioritizes providerSessionId for routing', () => {
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: 'ses_abc123',
      connectionId: 'conn-xyz',
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolveMessageTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_abc123');
    expect(result!.providerSessionId).toBe('ses_abc123');
    expect(result!.connectionId).toBe('conn-xyz');
    expect(result!.resolvedVia).toBe('node-session');
  });

  it('falls back to connectionId for direct connections', () => {
    const node = createMockNode({
      id: 'conn-direct',
      providerSessionId: null,
      connectionId: 'conn-direct',
      isDirectConnection: true,
    });
    const nodes = new Map([['conn-direct', node]]);

    const result = resolveMessageTarget(nodes, 'conn-direct');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('conn-direct');
    expect(result!.connectionId).toBe('conn-direct');
    expect(result!.providerSessionId).toBeNull();
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('falls back to node.id when no session or connection ID', () => {
    const node = createMockNode({
      id: 'fallback-id',
      providerSessionId: null,
      connectionId: null,
    });
    const nodes = new Map([['fallback-id', node]]);

    const result = resolveMessageTarget(nodes, 'fallback-id');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('fallback-id');
    expect(result!.connectionId).toBe('fallback-id');
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('does not require a prompt (unlike resolvePromptTarget)', () => {
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: 'ses_abc',
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
      providerSessionId: 'ses_abc123',
      connectionId: 'conn-xyz',
    });
    const nodes = new Map([['ses_abc123', node]]);

    const result = resolveTargetBySessionId(nodes, 'ses_abc123');

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_abc123');
    expect(result!.sessionId).toBe('ses_abc123');
  });

  it('returns null when sessionId does not match a map key (no field-scan fallback)', () => {
    const node = createMockNode({
      id: 'different-key',
      providerSessionId: 'ses_target',
      connectionId: 'conn-xyz',
    });
    const nodes = new Map([['different-key', node]]);

    // After Phase 5, resolveTargetBySessionId is a direct map lookup.
    // The node's providerSessionId field is not scanned.
    const result = resolveTargetBySessionId(nodes, 'ses_target');

    expect(result).toBeNull();
  });

  it('returns null when sessionId matches only a connectionId field (no field-scan fallback)', () => {
    const node = createMockNode({
      id: 'node-key',
      providerSessionId: null,
      connectionId: 'conn-target',
    });
    const nodes = new Map([['node-key', node]]);

    const result = resolveTargetBySessionId(nodes, 'conn-target');

    expect(result).toBeNull();
  });

  it('resolves a direct-connection node by its connectionId-keyed map entry', () => {
    const node = createMockNode({
      id: 'conn-target',
      providerSessionId: null,
      connectionId: 'conn-target',
      isDirectConnection: true,
    });
    const nodes = new Map([['conn-target', node]]);

    const result = resolveTargetBySessionId(nodes, 'conn-target');

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('conn-target');
    expect(result!.sessionId).toBe('conn-target');
    expect(result!.connectionId).toBe('conn-target');
    expect(result!.resolvedVia).toBe('node-connection');
  });

  it('returns the node matching the exact sessionId map key', () => {
    // After Phase 5 the map is keyed by identity; duplicate identities via
    // other fields are not scanned. Only the exact key lookup matters.
    const node1 = createMockNode({
      id: 'ses_target',
      providerSessionId: 'ses_target',
      connectionId: 'conn-other',
    });
    const node2 = createMockNode({
      id: 'node-2',
      providerSessionId: null,
      connectionId: 'ses_target', // Only here as a field; not a map key.
    });
    const nodes = new Map([
      ['ses_target', node1],
      ['node-2', node2],
    ]);

    const result = resolveTargetBySessionId(nodes, 'ses_target');

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_target');
    expect(result!.providerSessionId).toBe('ses_target');
  });
});

describe('resolveInteractiveMessageTarget', () => {
  it('prefers active channel target when requested session belongs to another channel', () => {
    const activeNode = createMockNode({
      id: 'ses_active',
      providerSessionId: 'ses_active',
      connectionId: 'conn_shared',
      title: 'Active',
    });
    const staleNode = createMockNode({
      id: 'ses_stale',
      providerSessionId: 'ses_stale',
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
      providerSessionId: 'ses_active',
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
      providerSessionId: 'ses_requested',
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
      providerSessionId: 'ses_active',
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
      providerSessionId: 'ses_active',
      connectionId: 'conn_shared',
    });
    const requestedNode = createMockNode({
      id: 'ses_requested',
      providerSessionId: 'ses_requested',
      connectionId: 'conn_shared',
    });
    const nodes = new Map([
      ['ses_active', activeNode],
      ['ses_requested', requestedNode],
    ]);

    const result = resolveInteractiveMessageTarget(
      nodes,
      null,
      'ses_requested',
    );

    expect(result).not.toBeNull();
    expect(result!.nodeKey).toBe('ses_requested');
    expect(result!.sessionId).toBe('ses_requested');
  });

  it('returns null when active channel is specified but cannot be resolved', () => {
    const requestedNode = createMockNode({
      id: 'ses_requested',
      providerSessionId: 'ses_requested',
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
// Parent-Child Session Routing Scenarios
// -----------------------------------------------------------------------------

describe('Parent-Child Session Routing', () => {
  it('routes prompt response to correct child session (not parent)', () => {
    // Scenario: Parent and child share connectionId, but have different providerSessionIds
    const parentNode = createMockNode({
      id: 'ses_parent',
      providerSessionId: 'ses_parent',
      connectionId: 'conn-shared', // Shared with child
      prompt: null,
    });

    const childPrompt = createMockPrompt({
      providerSessionId: 'ses_child', // Child's session ID
      connectionId: 'conn-shared', // Same as parent
    });
    const childNode = createMockNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
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
    expect(result!.providerSessionId).toBe('ses_child');
    expect(result!.connectionId).toBe('conn-shared');
  });

  it('routes queued message to correct session even with shared connectionId', () => {
    const parentNode = createMockNode({
      id: 'ses_parent',
      providerSessionId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const childNode = createMockNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
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
      providerSessionId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const childNode = createMockNode({
      id: 'ses_child',
      providerSessionId: 'ses_child',
      openCodeParentId: 'ses_parent',
      connectionId: 'conn-shared',
    });

    const grandchildPrompt = createMockPrompt({
      providerSessionId: 'ses_grandchild',
      connectionId: 'conn-shared',
    });
    const grandchildNode = createMockNode({
      id: 'ses_grandchild',
      providerSessionId: 'ses_grandchild',
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
    expect(result!.providerSessionId).toBe('ses_grandchild');
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
  });

  it('handles node with all IDs being the same', () => {
    const node = createMockNode({
      id: 'same-id',
      providerSessionId: 'same-id',
      connectionId: 'same-id',
    });
    const nodes = new Map([['same-id', node]]);

    const result = resolveMessageTarget(nodes, 'same-id');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('same-id');
    expect(result!.nodeKey).toBe('same-id');
  });

  it('prompt payload session ID is ignored; node identity is authoritative', () => {
    const prompt = createMockPrompt({
      providerSessionId: '', // Empty string (falsy)
      connectionId: 'conn-abc',
    });
    const node = createMockNode({
      id: 'node-1',
      providerSessionId: 'ses_node',
      connectionId: 'conn-abc',
      prompt,
    });
    const nodes = new Map([['node-1', node]]);

    const result = resolvePromptTarget(nodes, 'node-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses_node');
    expect(result!.resolvedVia).toBe('prompt-session');
  });
});
