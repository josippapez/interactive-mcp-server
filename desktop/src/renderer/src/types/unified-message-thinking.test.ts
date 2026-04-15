import { describe, it, expect } from 'vitest';
import { conversationToUnified } from './unified-message';
import type { ConversationMessage } from '../../../preload/index';

function makeConversationMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 'conv-msg-thinking',
    sessionId: 'ses_123',
    role: 'assistant',
    parts: [{ id: 'part-1', type: 'text', text: 'Hello world' }],
    createdAt: new Date('2026-04-11T10:00:00.000Z').getTime(),
    ...overrides,
  };
}

describe('conversationToUnified thinking extraction', () => {
  it('extracts reasoning from typed reasoning parts', () => {
    const msg = makeConversationMessage({
      parts: [
        { id: 'reason-1', type: 'reasoning', text: 'Plan the change' },
        { id: 'text-1', type: 'text', text: 'Final answer' },
      ],
    });

    const result = conversationToUnified(msg);

    expect(result.reasoning).toBe('Plan the change');
    expect(result.text).toBe('Final answer');
  });

  it('extracts inline thinking blocks from text parts', () => {
    const msg = makeConversationMessage({
      parts: [
        {
          id: 'text-1',
          type: 'text',
          text: '<thinking>Now I need to inspect the list</thinking>Visible answer',
        },
      ],
    });

    const result = conversationToUnified(msg);

    expect(result.reasoning).toBe('Now I need to inspect the list');
    expect(result.text).toBe('Visible answer');
  });

  it('combines typed reasoning with inline thinking blocks', () => {
    const msg = makeConversationMessage({
      parts: [
        { id: 'reason-1', type: 'reasoning', text: 'Typed reasoning' },
        {
          id: 'text-1',
          type: 'text',
          text: '<thinking>Inline reasoning</thinking>Visible answer',
        },
      ],
    });

    const result = conversationToUnified(msg);

    expect(result.reasoning).toBe('Typed reasoning\n\nInline reasoning');
    expect(result.text).toBe('Visible answer');
  });
});
