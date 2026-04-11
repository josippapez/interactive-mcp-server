import { describe, it, expect } from 'vitest';
import {
  collectDescendantKeys,
  findKeyByConnectionId,
  findPromptTargetKey,
} from './useIpcListeners';
import type { SessionNode } from '../types';

function makeNode(
  id: string,
  openCodeSessionId: string | null,
  openCodeParentId: string | null,
  connectionId?: string | null,
): SessionNode {
  return {
    id,
    openCodeSessionId,
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
    vcsInfo: null,
  };
}

// ---------------------------------------------------------------------------
// findKeyByConnectionId
// ---------------------------------------------------------------------------

describe('findKeyByConnectionId', () => {
  it('returns the map key when connectionId matches directly', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(findKeyByConnectionId(nodes, 'uuid-aaa')).toBe('ses_root');
  });

  it('returns null when no node matches and no openCodeSessionId hint', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(findKeyByConnectionId(nodes, 'uuid-unknown')).toBeNull();
  });

  it('falls back to openCodeSessionId when connectionId does not match any node', () => {
    // Node is keyed by openCodeSessionId "ses_sub123" with a stale auto-connectionId.
    // The new UUID doesn't match any node's connectionId, but the
    // openCodeSessionId hint allows the fallback to find the correct node.
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

  it('prefers openCodeSessionId over connectionId when openCodeSessionId is provided', () => {
    // Two nodes: one with matching connectionId, another with matching openCodeSessionId key.
    // This simulates OpenCode's shared MCP client where multiple sessions share the same connectionId.
    // When the caller provides openCodeSessionId, that should take priority over connectionId.
    const nodes = new Map([
      ['ses_a', makeNode('ses_a', 'ses_a', null, 'uuid-shared')],
      ['ses_b', makeNode('ses_b', 'ses_b', null, 'uuid-shared')],
    ]);
    // openCodeSessionId hint wins when provided - routes to the correct subagent
    expect(findKeyByConnectionId(nodes, 'uuid-shared', 'ses_b')).toBe('ses_b');
  });

  it('falls back to connectionId when openCodeSessionId is not provided', () => {
    // When no openCodeSessionId is provided, fall back to connectionId matching
    const nodes = new Map([
      ['ses_a', makeNode('ses_a', 'ses_a', null, 'uuid-match')],
      ['ses_b', makeNode('ses_b', 'ses_b', null, 'auto-ses_b')],
    ]);
    // No openCodeSessionId hint - use connectionId matching
    expect(findKeyByConnectionId(nodes, 'uuid-match')).toBe('ses_a');
  });

  it('returns null when openCodeSessionId hint has no corresponding node', () => {
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
  it('returns the map key when connectionId matches directly', () => {
    const nodes = new Map([
      ['ses_root', makeNode('ses_root', 'ses_root', null, 'uuid-aaa')],
    ]);
    expect(findPromptTargetKey(nodes, 'uuid-aaa')).toBe('ses_root');
  });

  it('falls back to openCodeSessionId when connectionId is stale', () => {
    const nodes = new Map([
      ['ses_sub', makeNode('ses_sub', 'ses_sub', 'ses_root', 'auto-ses_sub')],
    ]);
    expect(findPromptTargetKey(nodes, 'uuid-new', 'ses_sub')).toBe('ses_sub');
  });

  it('returns null when neither connectionId nor openCodeSessionId matches', () => {
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
