import { describe, it, expect } from 'vitest';
import { findKeyByConnectionId, findPromptTargetKey } from './useIpcListeners';
import type { SessionNode } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: 'node-1',
    openCodeSessionId: null,
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
    baseDirectory: null,
    pendingPermissions: [],
    vcsInfo: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findKeyByConnectionId
// ---------------------------------------------------------------------------

describe('findKeyByConnectionId', () => {
  it('returns the map key when the key itself IS the connectionId (direct connection)', () => {
    // Direct connections use connectionId as their map key
    const nodes = new Map<string, SessionNode>([
      [
        'conn-direct',
        makeNode({
          id: 'conn-direct',
          connectionId: 'conn-direct',
          isDirectConnection: true,
        }),
      ],
    ]);

    expect(findKeyByConnectionId(nodes, 'conn-direct')).toBe('conn-direct');
  });

  it('returns the openCodeSessionId map key when the node is an OpenCode-backed session', () => {
    // OpenCode sessions are keyed by openCodeSessionId, but their connectionId differs
    const nodes = new Map<string, SessionNode>([
      [
        'ses_opencode_123',
        makeNode({
          id: 'ses_opencode_123',
          openCodeSessionId: 'ses_opencode_123',
          connectionId: 'conn-mcp-456',
          isDirectConnection: false,
        }),
      ],
    ]);

    // data.sessionId = connectionId = 'conn-mcp-456'
    // but the map key = openCodeSessionId = 'ses_opencode_123'
    expect(findKeyByConnectionId(nodes, 'conn-mcp-456')).toBe(
      'ses_opencode_123',
    );
  });

  it('returns null when no node matches the given connectionId', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_opencode_abc',
        makeNode({
          id: 'ses_opencode_abc',
          openCodeSessionId: 'ses_opencode_abc',
          connectionId: 'conn-xyz',
        }),
      ],
    ]);

    expect(findKeyByConnectionId(nodes, 'conn-unknown')).toBeNull();
  });

  it('returns null for an empty map', () => {
    expect(findKeyByConnectionId(new Map(), 'conn-any')).toBeNull();
  });

  it('returns the first matching key when multiple nodes share a connectionId', () => {
    // Degenerate case — should not happen in practice, but function is deterministic
    const nodes = new Map<string, SessionNode>([
      ['key-a', makeNode({ id: 'key-a', connectionId: 'conn-shared' })],
      ['key-b', makeNode({ id: 'key-b', connectionId: 'conn-shared' })],
    ]);

    const result = findKeyByConnectionId(nodes, 'conn-shared');
    expect(['key-a', 'key-b']).toContain(result);
  });

  // -------------------------------------------------------------------------
  // openCodeSessionId priority (critical for prompt recovery after app restart)
  // -------------------------------------------------------------------------

  it('prioritizes openCodeSessionId over connectionId when both are provided', () => {
    // After app restart, a node might have a null connectionId but still have
    // an openCodeSessionId. The prompt recovery needs to match by openCodeSessionId.
    const nodes = new Map<string, SessionNode>([
      [
        'ses_abc123',
        makeNode({
          id: 'ses_abc123',
          openCodeSessionId: 'ses_abc123',
          connectionId: null, // Not yet reconnected
        }),
      ],
    ]);

    // When openCodeSessionId is provided, it should find the node even if
    // connectionId doesn't match (because node.connectionId is null)
    expect(findKeyByConnectionId(nodes, 'conn-old-uuid', 'ses_abc123')).toBe(
      'ses_abc123',
    );
  });

  it('matches by openCodeSessionId field when map key differs', () => {
    // Edge case: node.openCodeSessionId differs from map key
    const nodes = new Map<string, SessionNode>([
      [
        'some-other-key',
        makeNode({
          id: 'some-other-key',
          openCodeSessionId: 'ses_xyz789',
          connectionId: 'conn-456',
        }),
      ],
    ]);

    expect(findKeyByConnectionId(nodes, 'conn-unrelated', 'ses_xyz789')).toBe(
      'some-other-key',
    );
  });

  it('falls back to connectionId match when openCodeSessionId is not found', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_abc123',
        makeNode({
          id: 'ses_abc123',
          openCodeSessionId: 'ses_abc123',
          connectionId: 'conn-mcp-456',
        }),
      ],
    ]);

    // No matching openCodeSessionId, but connectionId matches
    expect(findKeyByConnectionId(nodes, 'conn-mcp-456', 'ses_unknown')).toBe(
      'ses_abc123',
    );
  });

  it('returns null when neither openCodeSessionId nor connectionId matches', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_abc123',
        makeNode({
          id: 'ses_abc123',
          openCodeSessionId: 'ses_abc123',
          connectionId: 'conn-mcp-456',
        }),
      ],
    ]);

    expect(
      findKeyByConnectionId(nodes, 'conn-unrelated', 'ses_unknown'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findPromptTargetKey
// ---------------------------------------------------------------------------

describe('findPromptTargetKey', () => {
  it('returns the node key itself when the node has no parent (root)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_root',
        makeNode({
          id: 'ses_root',
          openCodeSessionId: 'ses_root',
          openCodeParentId: null,
          connectionId: 'conn-root',
          depth: 0,
        }),
      ],
    ]);

    expect(findPromptTargetKey(nodes, 'conn-root')).toBe('ses_root');
  });

  it('returns the child node key itself (no parent walking)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_parent',
        makeNode({
          id: 'ses_parent',
          openCodeSessionId: 'ses_parent',
          openCodeParentId: null,
          connectionId: 'conn-parent',
          depth: 0,
        }),
      ],
      [
        'ses_child',
        makeNode({
          id: 'ses_child',
          openCodeSessionId: 'ses_child',
          openCodeParentId: 'ses_parent',
          connectionId: 'conn-child',
          depth: 1,
        }),
      ],
    ]);

    // Prompt from child agent appears in the child's own channel
    expect(findPromptTargetKey(nodes, 'conn-child')).toBe('ses_child');
  });

  it('returns the leaf node key itself for deeply nested agents', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_root',
        makeNode({
          id: 'ses_root',
          openCodeSessionId: 'ses_root',
          openCodeParentId: null,
          connectionId: 'conn-root',
          depth: 0,
        }),
      ],
      [
        'ses_mid',
        makeNode({
          id: 'ses_mid',
          openCodeSessionId: 'ses_mid',
          openCodeParentId: 'ses_root',
          connectionId: 'conn-mid',
          depth: 1,
        }),
      ],
      [
        'ses_leaf',
        makeNode({
          id: 'ses_leaf',
          openCodeSessionId: 'ses_leaf',
          openCodeParentId: 'ses_mid',
          connectionId: 'conn-leaf',
          depth: 2,
        }),
      ],
    ]);

    // Prompt from deeply nested leaf stays in its own channel
    expect(findPromptTargetKey(nodes, 'conn-leaf')).toBe('ses_leaf');
  });

  it('returns null when connectionId is not found', () => {
    expect(findPromptTargetKey(new Map(), 'conn-missing')).toBeNull();
  });

  it('returns the direct-connection node key unchanged (no parent walk for direct connections)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'conn-direct',
        makeNode({
          id: 'conn-direct',
          openCodeSessionId: null,
          openCodeParentId: null,
          connectionId: 'conn-direct',
          isDirectConnection: true,
          depth: 0,
        }),
      ],
    ]);

    expect(findPromptTargetKey(nodes, 'conn-direct')).toBe('conn-direct');
  });
});
