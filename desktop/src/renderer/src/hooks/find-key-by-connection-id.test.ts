import { describe, it, expect } from 'vitest';
import { findKeyByConnectionId } from './useIpcListeners';
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
});
