import { describe, it, expect } from 'vitest';
import {
  channelToUnified,
  conversationToUnified,
  mergeMessages,
} from './unified-message';
import type { ChannelMessage, Attachment } from '../types';
import type { ConversationMessage } from '../../../preload/index';

// ---------------------------------------------------------------------------
// Helpers — create minimal valid fixtures
// ---------------------------------------------------------------------------

function makeChannelMessage(
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id: 'ch-msg-1',
    kind: 'question',
    text: 'Test message',
    timestamp: new Date('2026-04-11T10:00:00.000Z'),
    ...overrides,
  };
}

function makeConversationMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 'conv-msg-1',
    sessionId: 'ses_123',
    role: 'assistant',
    parts: [{ id: 'part-1', type: 'text', text: 'Hello world' }],
    createdAt: new Date('2026-04-11T10:00:00.000Z').getTime(),
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    data: 'base64data',
    mimeType: 'image/png',
    name: 'test.png',
    size: 1024,
    ...overrides,
  };
}

// ===========================================================================
// channelToUnified
// ===========================================================================

describe('channelToUnified', () => {
  it('converts a question message to unified format with assistant role', () => {
    const msg = makeChannelMessage({ kind: 'question', text: 'What is this?' });
    const result = channelToUnified(msg);

    expect(result.id).toBe('ch-msg-1');
    expect(result.source).toBe('channel');
    expect(result.role).toBe('assistant'); // question = from agent
    expect(result.text).toBe('What is this?');
    expect(result.channelKind).toBe('question');
    expect(result.isActivePrompt).toBe(false);
  });

  it('converts an answer message to unified format with user role', () => {
    const msg = makeChannelMessage({ kind: 'answer', text: 'My response' });
    const result = channelToUnified(msg);

    expect(result.role).toBe('user');
    expect(result.channelKind).toBe('answer');
  });

  it('converts an outbound message to sent role when sent=true', () => {
    const msg = makeChannelMessage({
      kind: 'outbound',
      text: 'Queued msg',
      sent: true,
    });
    const result = channelToUnified(msg);

    expect(result.role).toBe('sent');
    expect(result.channelKind).toBe('outbound');
  });

  it('converts an outbound message to queued role when sent=false', () => {
    const msg = makeChannelMessage({
      kind: 'outbound',
      text: 'Pending',
      sent: false,
    });
    const result = channelToUnified(msg);

    expect(result.role).toBe('queued');
  });

  it('converts an agent_message to assistant role', () => {
    const msg = makeChannelMessage({
      kind: 'agent_message',
      text: 'Status update',
    });
    const result = channelToUnified(msg);

    expect(result.role).toBe('assistant');
    expect(result.channelKind).toBe('agent_message');
  });

  it('marks message as active prompt when isActivePrompt is true', () => {
    const msg = makeChannelMessage({ kind: 'question' });
    const result = channelToUnified(msg, true);

    expect(result.isActivePrompt).toBe(true);
  });

  it('preserves attachments from channel message', () => {
    const attachment = makeAttachment({ name: 'image.png' });
    const msg = makeChannelMessage({ attachments: [attachment] });
    const result = channelToUnified(msg);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].name).toBe('image.png');
  });

  it('converts timestamp to milliseconds since epoch', () => {
    const timestamp = new Date('2026-04-11T10:00:00.000Z');
    const msg = makeChannelMessage({ timestamp });
    const result = channelToUnified(msg);

    expect(result.timestamp).toBe(timestamp.getTime());
  });
});

// ===========================================================================
// conversationToUnified
// ===========================================================================

describe('conversationToUnified', () => {
  it('converts an assistant message to unified format', () => {
    const msg = makeConversationMessage({
      role: 'assistant',
      modelId: 'claude-3',
      agent: 'code',
    });
    const result = conversationToUnified(msg);

    expect(result.id).toBe('conv-msg-1');
    expect(result.source).toBe('conversation');
    expect(result.role).toBe('assistant');
    expect(result.text).toBe('Hello world');
    expect(result.modelId).toBe('claude-3');
    expect(result.agent).toBe('code');
  });

  it('converts a user message to unified format', () => {
    const msg = makeConversationMessage({
      role: 'user',
      parts: [{ id: 'p1', type: 'text', text: 'User input' }],
    });
    const result = conversationToUnified(msg);

    expect(result.role).toBe('user');
    expect(result.text).toBe('User input');
  });

  it('converts a system message to unified format', () => {
    const msg = makeConversationMessage({
      role: 'system',
      parts: [{ id: 'p1', type: 'text', text: 'System prompt' }],
    });
    const result = conversationToUnified(msg);

    expect(result.role).toBe('system');
  });

  it('joins multiple text parts with double newlines', () => {
    const msg = makeConversationMessage({
      parts: [
        { id: 'p1', type: 'text', text: 'First paragraph' },
        { id: 'p2', type: 'text', text: 'Second paragraph' },
      ],
    });
    const result = conversationToUnified(msg);

    expect(result.text).toBe('First paragraph\n\nSecond paragraph');
  });

  it('extracts tool calls from parts', () => {
    const msg = makeConversationMessage({
      parts: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolName: 'read_file',
          toolStatus: 'completed',
          toolInput: { path: '/test.ts' },
          toolOutput: 'file content',
        },
      ],
    });
    const result = conversationToUnified(msg);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'tool-1',
      name: 'read_file',
      status: 'completed',
      input: { path: '/test.ts' },
      output: 'file content',
    });
  });

  it('handles tool calls with missing toolName', () => {
    const msg = makeConversationMessage({
      parts: [
        {
          id: 'tool-1',
          type: 'tool-call',
          toolStatus: 'running',
        },
      ],
    });
    const result = conversationToUnified(msg);

    expect(result.toolCalls![0].name).toBe('Unknown tool');
  });

  it('excludes toolCalls when no tool-call parts exist', () => {
    const msg = makeConversationMessage({
      parts: [{ id: 'p1', type: 'text', text: 'Just text' }],
    });
    const result = conversationToUnified(msg);

    expect(result.toolCalls).toBeUndefined();
  });

  it('preserves token usage information', () => {
    const msg = makeConversationMessage({
      tokens: { input: 100, output: 200, total: 300 },
    });
    const result = conversationToUnified(msg);

    expect(result.tokens).toEqual({ input: 100, output: 200, total: 300 });
  });

  it('preserves cost information', () => {
    const msg = makeConversationMessage({ cost: 0.0025 });
    const result = conversationToUnified(msg);

    expect(result.cost).toBe(0.0025);
  });

  it('uses createdAt as timestamp', () => {
    const createdAt = new Date('2026-04-11T12:30:00.000Z').getTime();
    const msg = makeConversationMessage({ createdAt });
    const result = conversationToUnified(msg);

    expect(result.timestamp).toBe(createdAt);
  });

  it('filters out non-text parts when extracting text', () => {
    const msg = makeConversationMessage({
      parts: [
        { id: 'p1', type: 'text', text: 'Visible text' },
        { id: 'p2', type: 'tool-call', toolName: 'bash' },
        { id: 'p3', type: 'image' },
      ],
    });
    const result = conversationToUnified(msg);

    expect(result.text).toBe('Visible text');
  });

  it('handles empty parts array', () => {
    const msg = makeConversationMessage({ parts: [] });
    const result = conversationToUnified(msg);

    expect(result.text).toBe('');
    expect(result.toolCalls).toBeUndefined();
  });
});

// ===========================================================================
// mergeMessages
// ===========================================================================

describe('mergeMessages', () => {
  it('returns empty array when both inputs are empty', () => {
    const result = mergeMessages([], []);

    expect(result).toEqual([]);
  });

  it('converts only channel messages when conversation is empty', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'ch-1',
        text: 'Question',
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const result = mergeMessages(channelMsgs, []);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('channel');
    expect(result[0].id).toBe('ch-1');
  });

  it('converts only conversation messages when channel is empty', () => {
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-1',
        createdAt: new Date('2026-04-11T10:00:00.000Z').getTime(),
      }),
    ];
    const result = mergeMessages([], convMsgs);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('conversation');
    expect(result[0].id).toBe('conv-1');
  });

  it('merges and sorts messages by timestamp', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'ch-1',
        timestamp: new Date('2026-04-11T10:05:00.000Z'),
      }),
      makeChannelMessage({
        id: 'ch-2',
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-1',
        createdAt: new Date('2026-04-11T10:02:30.000Z').getTime(),
      }),
    ];
    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result.map((m) => m.id)).toEqual(['ch-2', 'conv-1', 'ch-1']);
  });

  it('marks the correct message as active prompt', () => {
    const channelMsgs = [
      makeChannelMessage({ id: 'prompt-1', kind: 'question' }),
      makeChannelMessage({ id: 'prompt-2', kind: 'question' }),
    ];
    const result = mergeMessages(channelMsgs, [], 'prompt-2');

    expect(result[0].isActivePrompt).toBe(false);
    expect(result[1].isActivePrompt).toBe(true);
  });

  it('handles null activePromptId', () => {
    const channelMsgs = [makeChannelMessage({ id: 'prompt-1' })];
    const result = mergeMessages(channelMsgs, [], null);

    expect(result[0].isActivePrompt).toBe(false);
  });

  it('preserves stable sort order for same timestamps', () => {
    const timestamp = new Date('2026-04-11T10:00:00.000Z');
    const channelMsgs = [
      makeChannelMessage({ id: 'ch-1', timestamp }),
      makeChannelMessage({ id: 'ch-2', timestamp }),
    ];
    const result = mergeMessages(channelMsgs, []);

    // Sort is stable — original order preserved for equal timestamps
    expect(result[0].id).toBe('ch-1');
    expect(result[1].id).toBe('ch-2');
  });

  it('handles large message arrays efficiently', () => {
    const channelMsgs: ChannelMessage[] = Array.from({ length: 100 }, (_, i) =>
      makeChannelMessage({
        id: `ch-${i}`,
        timestamp: new Date(Date.now() - i * 1000),
      }),
    );
    const convMsgs: ConversationMessage[] = Array.from(
      { length: 100 },
      (_, i) =>
        makeConversationMessage({
          id: `conv-${i}`,
          createdAt: Date.now() - i * 1000 - 500,
        }),
    );

    const start = performance.now();
    const result = mergeMessages(channelMsgs, convMsgs);
    const duration = performance.now() - start;

    expect(result).toHaveLength(200);
    // Should complete in well under 100ms
    expect(duration).toBeLessThan(100);
  });
});
