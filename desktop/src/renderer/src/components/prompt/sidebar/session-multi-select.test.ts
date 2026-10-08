import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../../types';
import {
  getBulkArchiveSessionIds,
  getVisibleSessionIds,
  resolveSessionSelection,
} from './session-multi-select';

function makeNode(id: string, parentId: string | null = null): SessionNode {
  return {
    id,
    providerSessionId: id,
    openCodeParentId: parentId,
    title: id,
    directory: '/repo',
    depth: parentId ? 1 : 0,
    connectionId: null,
    hasMcpChannel: true,
    isDirectConnection: false,
    providerType: 'opencode',
    prompt: null,
    activeSession: null,
    baseDirectory: '/repo',
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: { sessionId: id },
    sessionStatuses: [],
    pendingPermissions: [],
    pendingQuestions: [],
    vcsInfo: null,
  };
}

describe('resolveSessionSelection', () => {
  it('toggles individual sessions with the toggle key', () => {
    const first = resolveSessionSelection({
      current: new Set(),
      clickedId: 'ses_1',
      visibleIds: ['ses_1', 'ses_2'],
      anchorId: null,
      shiftKey: false,
      toggleKey: true,
    });

    expect(Array.from(first.selectedIds)).toEqual(['ses_1']);

    const second = resolveSessionSelection({
      current: first.selectedIds,
      clickedId: 'ses_1',
      visibleIds: ['ses_1', 'ses_2'],
      anchorId: first.anchorId,
      shiftKey: false,
      toggleKey: true,
    });

    expect(Array.from(second.selectedIds)).toEqual([]);
  });

  it('adds the range from the anchor with shift click', () => {
    const result = resolveSessionSelection({
      current: new Set(['ses_4']),
      clickedId: 'ses_3',
      visibleIds: ['ses_1', 'ses_2', 'ses_3', 'ses_4'],
      anchorId: 'ses_1',
      shiftKey: true,
      toggleKey: false,
    });

    expect(Array.from(result.selectedIds)).toEqual([
      'ses_4',
      'ses_1',
      'ses_2',
      'ses_3',
    ]);
  });
});

describe('getVisibleSessionIds', () => {
  it('omits descendants hidden under collapsed parents', () => {
    const sessions = [
      makeNode('ses_parent'),
      makeNode('ses_child', 'ses_parent'),
    ];

    expect(
      getVisibleSessionIds([{ sessions }], new Set(['ses_parent'])),
    ).toEqual(['ses_parent']);
  });
});

describe('getBulkArchiveSessionIds', () => {
  it('dedupes selected descendants when their parent is selected', () => {
    const nodes = new Map([
      ['ses_parent', makeNode('ses_parent')],
      ['ses_child', makeNode('ses_child', 'ses_parent')],
      ['ses_other', makeNode('ses_other')],
    ]);

    expect(
      getBulkArchiveSessionIds(
        nodes,
        new Set(['ses_parent', 'ses_child', 'ses_other']),
        'ses_parent',
      ),
    ).toEqual(['ses_parent', 'ses_other']);
  });
});
