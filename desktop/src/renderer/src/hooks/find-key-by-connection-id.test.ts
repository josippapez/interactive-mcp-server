import { describe, it, expect } from 'vitest';
import { findKeyByConnectionId, findPromptTargetKey } from './useIpcListeners';
import type { SessionNode } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    baseDirectory: null,
    pendingPermissions: [],
    pendingQuestions: [],
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

  it('returns the providerSessionId map key when the node is an OpenCode-backed session', () => {
    // OpenCode-backed nodes can ONLY be matched by providerSessionId.
    // Without a providerSessionId hint, the connectionId-only fallback is
    // intentionally disabled for these nodes (multiple OC sessions share the
    // same MCP transport UUID, so a connectionId-only match would be
    // non-deterministic and corrupt cross-channel routing).
    const nodes = new Map<string, SessionNode>([
      [
        'ses_opencode_123',
        makeNode({
          id: 'ses_opencode_123',
          providerSessionId: 'ses_opencode_123',
          connectionId: 'conn-mcp-456',
          isDirectConnection: false,
        }),
      ],
    ]);

    // With providerSessionId: matches.
    expect(
      findKeyByConnectionId(nodes, 'conn-mcp-456', 'ses_opencode_123'),
    ).toBe('ses_opencode_123');
    // Without providerSessionId: returns null (cannot disambiguate).
    expect(findKeyByConnectionId(nodes, 'conn-mcp-456')).toBeNull();
  });

  it('returns null when no node matches the given connectionId', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_opencode_abc',
        makeNode({
          id: 'ses_opencode_abc',
          providerSessionId: 'ses_opencode_abc',
          connectionId: 'conn-xyz',
        }),
      ],
    ]);

    expect(findKeyByConnectionId(nodes, 'conn-unknown')).toBeNull();
  });

  it('returns null for an empty map', () => {
    expect(findKeyByConnectionId(new Map(), 'conn-any')).toBeNull();
  });

  it('returns the first matching key when multiple direct-connection nodes share a connectionId', () => {
    // Degenerate case for direct connections — should not happen in practice.
    // Both nodes are direct connections (no providerSessionId), so connectionId
    // fallback is allowed.
    const nodes = new Map<string, SessionNode>([
      [
        'key-a',
        makeNode({
          id: 'key-a',
          connectionId: 'conn-shared',
          isDirectConnection: true,
        }),
      ],
      [
        'key-b',
        makeNode({
          id: 'key-b',
          connectionId: 'conn-shared',
          isDirectConnection: true,
        }),
      ],
    ]);

    const result = findKeyByConnectionId(nodes, 'conn-shared');
    expect(['key-a', 'key-b']).toContain(result);
  });

  it('does NOT match an OpenCode-backed node by connectionId alone (prevents cross-channel routing)', () => {
    // Two OC sessions sharing the same MCP transport UUID — the bug scenario.
    // Without a providerSessionId hint, neither should match.
    const nodes = new Map<string, SessionNode>([
      [
        'ses_a',
        makeNode({
          id: 'ses_a',
          providerSessionId: 'ses_a',
          connectionId: 'shared-mcp-uuid',
        }),
      ],
      [
        'ses_b',
        makeNode({
          id: 'ses_b',
          providerSessionId: 'ses_b',
          connectionId: 'shared-mcp-uuid',
        }),
      ],
    ]);

    expect(findKeyByConnectionId(nodes, 'shared-mcp-uuid')).toBeNull();
    expect(findKeyByConnectionId(nodes, 'shared-mcp-uuid', 'ses_a')).toBe(
      'ses_a',
    );
    expect(findKeyByConnectionId(nodes, 'shared-mcp-uuid', 'ses_b')).toBe(
      'ses_b',
    );
  });

  // -------------------------------------------------------------------------
  // providerSessionId priority (critical for prompt recovery after app restart)
  // -------------------------------------------------------------------------

  it('prioritizes providerSessionId over connectionId when both are provided', () => {
    // After app restart, a node might have a null connectionId but still have
    // an providerSessionId. The prompt recovery needs to match by providerSessionId.
    const nodes = new Map<string, SessionNode>([
      [
        'ses_abc123',
        makeNode({
          id: 'ses_abc123',
          providerSessionId: 'ses_abc123',
          connectionId: null, // Not yet reconnected
        }),
      ],
    ]);

    // When providerSessionId is provided, it should find the node even if
    // connectionId doesn't match (because node.connectionId is null)
    expect(findKeyByConnectionId(nodes, 'conn-old-uuid', 'ses_abc123')).toBe(
      'ses_abc123',
    );
  });

  it('matches by providerSessionId field when map key differs', () => {
    // Edge case: node.providerSessionId differs from map key
    const nodes = new Map<string, SessionNode>([
      [
        'some-other-key',
        makeNode({
          id: 'some-other-key',
          providerSessionId: 'ses_xyz789',
          connectionId: 'conn-456',
        }),
      ],
    ]);

    expect(findKeyByConnectionId(nodes, 'conn-unrelated', 'ses_xyz789')).toBe(
      'some-other-key',
    );
  });

  it('falls back to connectionId match when providerSessionId is not found AND target node is a direct connection', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'conn-direct-1',
        makeNode({
          id: 'conn-direct-1',
          providerSessionId: null,
          connectionId: 'conn-direct-1',
          isDirectConnection: true,
        }),
      ],
    ]);

    // No matching providerSessionId, but connectionId matches a direct connection
    expect(findKeyByConnectionId(nodes, 'conn-direct-1', 'ses_unknown')).toBe(
      'conn-direct-1',
    );
  });

  it('does NOT fall back to connectionId match when target node is OpenCode-backed', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_abc123',
        makeNode({
          id: 'ses_abc123',
          providerSessionId: 'ses_abc123',
          connectionId: 'conn-mcp-456',
          isDirectConnection: false,
        }),
      ],
    ]);

    // Even though connectionId matches, the OC-backed node refuses
    // connectionId-only matching when the providerSessionId hint is wrong.
    expect(
      findKeyByConnectionId(nodes, 'conn-mcp-456', 'ses_unknown'),
    ).toBeNull();
  });

  it('returns null when neither providerSessionId nor connectionId matches', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_abc123',
        makeNode({
          id: 'ses_abc123',
          providerSessionId: 'ses_abc123',
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
          providerSessionId: 'ses_root',
          openCodeParentId: null,
          connectionId: 'conn-root',
          depth: 0,
        }),
      ],
    ]);

    expect(findPromptTargetKey(nodes, 'conn-root', 'ses_root')).toBe(
      'ses_root',
    );
  });

  it('returns the child node key itself (no parent walking)', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_parent',
        makeNode({
          id: 'ses_parent',
          providerSessionId: 'ses_parent',
          openCodeParentId: null,
          connectionId: 'conn-parent',
          depth: 0,
        }),
      ],
      [
        'ses_child',
        makeNode({
          id: 'ses_child',
          providerSessionId: 'ses_child',
          openCodeParentId: 'ses_parent',
          connectionId: 'conn-child',
          depth: 1,
        }),
      ],
    ]);

    // Prompt from child agent appears in the child's own channel
    expect(findPromptTargetKey(nodes, 'conn-child', 'ses_child')).toBe(
      'ses_child',
    );
  });

  it('returns the leaf node key itself for deeply nested agents', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'ses_root',
        makeNode({
          id: 'ses_root',
          providerSessionId: 'ses_root',
          openCodeParentId: null,
          connectionId: 'conn-root',
          depth: 0,
        }),
      ],
      [
        'ses_mid',
        makeNode({
          id: 'ses_mid',
          providerSessionId: 'ses_mid',
          openCodeParentId: 'ses_root',
          connectionId: 'conn-mid',
          depth: 1,
        }),
      ],
      [
        'ses_leaf',
        makeNode({
          id: 'ses_leaf',
          providerSessionId: 'ses_leaf',
          openCodeParentId: 'ses_mid',
          connectionId: 'conn-leaf',
          depth: 2,
        }),
      ],
    ]);

    // Prompt from deeply nested leaf stays in its own channel
    expect(findPromptTargetKey(nodes, 'conn-leaf', 'ses_leaf')).toBe(
      'ses_leaf',
    );
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
          providerSessionId: null,
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
