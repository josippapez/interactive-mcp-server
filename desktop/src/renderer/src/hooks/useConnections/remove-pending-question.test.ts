import { describe, it, expect } from 'vitest';
import type { PendingQuestion, SessionNode } from '../../types';
import { removePendingQuestion } from './remove-pending-question';

function makeQuestion(requestId: string): PendingQuestion {
  return {
    requestId,
    sessionID: 'ses_1',
    questions: [
      {
        question: 'q?',
        header: 'H',
        options: [],
        multiple: false,
        custom: true,
      },
    ],
  };
}

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
    pendingPermissions: [],
    pendingQuestions: [],
    baseDirectory: null,
    vcsInfo: null,
    ...overrides,
  };
}

describe('removePendingQuestion', () => {
  it('returns the same Map reference when no node contains the requestId', () => {
    const node = makeNode({ pendingQuestions: [makeQuestion('req-1')] });
    const map = new Map<string, SessionNode>([['node-1', node]]);

    const result = removePendingQuestion(map, 'req-other');

    expect(result).toBe(map);
  });

  it('removes the question from the matching node and clears hasPendingPrompt', () => {
    const node = makeNode({
      pendingQuestions: [makeQuestion('req-1')],
      hasPendingPrompt: true,
    });
    const map = new Map<string, SessionNode>([['node-1', node]]);

    const result = removePendingQuestion(map, 'req-1');

    expect(result).not.toBe(map);
    expect(result.get('node-1')!.pendingQuestions).toEqual([]);
    expect(result.get('node-1')!.hasPendingPrompt).toBe(false);
  });

  it('keeps hasPendingPrompt true when other questions remain', () => {
    const node = makeNode({
      pendingQuestions: [makeQuestion('req-1'), makeQuestion('req-2')],
      hasPendingPrompt: true,
    });
    const map = new Map<string, SessionNode>([['node-1', node]]);

    const result = removePendingQuestion(map, 'req-1');

    expect(result.get('node-1')!.pendingQuestions).toHaveLength(1);
    expect(result.get('node-1')!.pendingQuestions[0].requestId).toBe('req-2');
    expect(result.get('node-1')!.hasPendingPrompt).toBe(true);
  });

  it('keeps hasPendingPrompt true when a prompt still exists even after last question removed', () => {
    const node = makeNode({
      pendingQuestions: [makeQuestion('req-1')],
      hasPendingPrompt: true,
      // @ts-expect-error - minimal prompt stub is sufficient for this test
      prompt: { id: 'p', message: 'hi', predefinedOptions: [] },
    });
    const map = new Map<string, SessionNode>([['node-1', node]]);

    const result = removePendingQuestion(map, 'req-1');

    expect(result.get('node-1')!.pendingQuestions).toEqual([]);
    expect(result.get('node-1')!.hasPendingPrompt).toBe(true);
  });

  it('only affects the node that owns the question', () => {
    const nodeA = makeNode({
      id: 'a',
      pendingQuestions: [makeQuestion('req-a')],
    });
    const nodeB = makeNode({
      id: 'b',
      pendingQuestions: [makeQuestion('req-b')],
    });
    const map = new Map<string, SessionNode>([
      ['a', nodeA],
      ['b', nodeB],
    ]);

    const result = removePendingQuestion(map, 'req-a');

    expect(result.get('a')!.pendingQuestions).toEqual([]);
    expect(result.get('b')).toBe(nodeB);
  });
});
