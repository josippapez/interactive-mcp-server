import { describe, it, expect } from 'vitest';
import { collectDescendantKeys } from './useIpcListeners';
import type { SessionNode } from '../types';

function makeNode(
  id: string,
  openCodeSessionId: string | null,
  openCodeParentId: string | null,
): SessionNode {
  return {
    id,
    openCodeSessionId,
    openCodeParentId,
    title: id,
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
  };
}

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
