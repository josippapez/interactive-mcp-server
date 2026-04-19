import { describe, it, expect } from 'vitest';
import type { ConversationMessage } from '../../../preload/index';
import { mergeConversationMessages } from './conversation-merge';

function msg(
  id: string,
  createdAt: number,
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id,
    sessionId: 'ses_1',
    role: 'user',
    parts: [],
    createdAt,
    ...overrides,
  };
}

describe('mergeConversationMessages', () => {
  it('returns the fetched batch when previous is empty', () => {
    const fetched = [msg('a', 1), msg('b', 2)];
    expect(mergeConversationMessages([], fetched)).toBe(fetched);
  });

  it('returns the previous list when fetched is empty', () => {
    const previous = [msg('a', 1)];
    expect(mergeConversationMessages(previous, [])).toBe(previous);
  });

  it('preserves older previous messages not returned by a capped fetch', () => {
    const previous = [msg('old1', 1), msg('old2', 2), msg('recent', 10)];
    const fetched = [msg('recent', 10), msg('new1', 11)];

    const merged = mergeConversationMessages(previous, fetched);

    expect(merged.map((m) => m.id)).toEqual(['old1', 'old2', 'recent', 'new1']);
  });

  it('replaces messages with matching ids using the fetched version', () => {
    const previous = [msg('a', 1, { role: 'user' })];
    const fetched = [msg('a', 1, { role: 'assistant' })];

    const merged = mergeConversationMessages(previous, fetched);

    expect(merged).toHaveLength(1);
    expect(merged[0].role).toBe('assistant');
  });

  it('sorts the merged result by createdAt ascending', () => {
    const previous = [msg('c', 30), msg('a', 10)];
    const fetched = [msg('b', 20), msg('d', 40)];

    const merged = mergeConversationMessages(previous, fetched);

    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
