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

  it('reflects updated text even when the same message object reference is reused', () => {
    const msg = makeConversationMessage({
      parts: [{ id: 'p1', type: 'text', text: 'initial text' }],
    });

    const first = conversationToUnified(msg);
    expect(first.text).toBe('initial text');

    // Simulate in-place streaming mutation from upstream transport code.
    msg.parts[0].text = 'updated text';

    const second = conversationToUnified(msg);
    expect(second.text).toBe('updated text');
  });

  // ---------------------------------------------------------------------------
  // Compaction detection tests
  // ---------------------------------------------------------------------------

  it('detects compaction message via mode field', () => {
    const msg = makeConversationMessage({
      mode: 'compaction',
      parts: [{ id: 'p1', type: 'text', text: 'Context summary' }],
    });
    const result = conversationToUnified(msg);

    expect(result.isCompaction).toBe(true);
    expect(result.text).toBe('Context summary');
  });

  it('detects compaction message via part type', () => {
    const msg = makeConversationMessage({
      role: 'user',
      parts: [{ id: 'p1', type: 'compaction', text: 'Compact context' }],
    });
    const result = conversationToUnified(msg);

    expect(result.isCompaction).toBe(true);
    expect(result.text).toBe('Compact context');
  });

  it('extracts text from compaction-type parts', () => {
    const msg = makeConversationMessage({
      mode: 'compaction',
      parts: [
        { id: 'p1', type: 'compaction', text: 'Compaction summary' },
        { id: 'p2', type: 'text', text: 'Additional text' },
      ],
    });
    const result = conversationToUnified(msg);

    expect(result.isCompaction).toBe(true);
    expect(result.text).toBe('Compaction summary\n\nAdditional text');
  });

  it('does NOT mark regular message as compaction', () => {
    const msg = makeConversationMessage({
      role: 'assistant',
      parts: [{ id: 'p1', type: 'text', text: 'Regular message' }],
    });
    const result = conversationToUnified(msg);

    expect(result.isCompaction).toBe(false);
  });

  it('does NOT mark message as compaction when mode is undefined', () => {
    // This simulates a placeholder message created by delta-batcher
    const msg = makeConversationMessage({
      role: 'assistant',
      // mode is intentionally NOT set (undefined)
      parts: [{ id: 'p1', type: 'text', text: 'Streaming text' }],
    });
    const result = conversationToUnified(msg);

    expect(result.isCompaction).toBe(false);
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

  it('reuses unified objects when message content signatures are unchanged', () => {
    const channelMessages = [
      makeChannelMessage({
        id: 'ch-stable',
        text: 'Stable question',
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const conversationMessages = [
      makeConversationMessage({
        id: 'conv-stable',
        parts: [{ id: 'p1', type: 'text', text: 'Stable answer' }],
      }),
    ];

    const first = mergeMessages(channelMessages, conversationMessages, null);
    const second = mergeMessages(channelMessages, conversationMessages, null);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it('recomputes only the changed conversation message when a part updates', () => {
    const conversationMessages = [
      makeConversationMessage({
        id: 'conv-a',
        parts: [{ id: 'p-a', type: 'text', text: 'A1' }],
      }),
      makeConversationMessage({
        id: 'conv-b',
        parts: [{ id: 'p-b', type: 'text', text: 'B1' }],
      }),
    ];

    const first = mergeMessages([], conversationMessages, null);
    conversationMessages[1].parts[0].text = 'B2';
    const second = mergeMessages([], conversationMessages, null);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].text).toBe('B2');
  });

  it('suppresses sent outbound channel messages when the same user message exists in conversation', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'out-1',
        kind: 'outbound',
        text: 'same message',
        sent: true,
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-user-1',
        role: 'user',
        createdAt: new Date('2026-04-11T10:00:01.000Z').getTime(),
        parts: [{ id: 'p1', type: 'text', text: 'same message' }],
      }),
    ];

    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('conv-user-1');
    expect(result[0].source).toBe('conversation');
  });

  it('suppresses sent outbound channel messages when whitespace differs across sources', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'out-1',
        kind: 'outbound',
        text: 'same   message\nwith spacing',
        sent: true,
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-user-1',
        role: 'user',
        createdAt: new Date('2026-04-11T10:00:01.000Z').getTime(),
        parts: [{ id: 'p1', type: 'text', text: 'same message with spacing' }],
      }),
    ];

    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('conv-user-1');
  });

  it('suppresses sent outbound channel messages when the provider user message keeps only the suffix after a prefix marker', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'out-1',
        kind: 'outbound',
        text: 'Build: Okay, it seems to be better',
        sent: true,
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-user-1',
        role: 'user',
        createdAt: new Date('2026-04-11T10:00:01.000Z').getTime(),
        parts: [{ id: 'p1', type: 'text', text: 'Okay, it seems to be better' }],
      }),
    ];

    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('conv-user-1');
  });

  it('keeps unsent outbound channel messages even when the text matches conversation', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'out-1',
        kind: 'outbound',
        text: 'same message',
        sent: undefined,
        timestamp: new Date('2026-04-11T10:00:00.000Z'),
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-user-1',
        role: 'user',
        createdAt: new Date('2026-04-11T10:00:01.000Z').getTime(),
        parts: [{ id: 'p1', type: 'text', text: 'same message' }],
      }),
    ];

    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result).toHaveLength(2);
  });

  it('suppresses tool-only interactive prompt messages when a channel prompt exists at the same time', () => {
    const timestamp = new Date('2026-04-11T10:00:00.000Z');
    const channelMsgs = [
      makeChannelMessage({
        id: 'prompt-1',
        kind: 'question',
        text: 'Are you satisfied with this result?',
        timestamp,
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-tool-1',
        createdAt: timestamp.getTime(),
        parts: [
          {
            id: 'tool-1',
            type: 'tool-call',
            toolName: 'interactive-desktop_request_user_input',
            toolStatus: 'running',
            toolInput: { message: 'Are you satisfied with this result?' },
          },
        ],
      }),
    ];

    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('prompt-1');
  });

  it('keeps tool-only conversation messages for non-interactive tools', () => {
    const timestamp = new Date('2026-04-11T10:00:00.000Z');
    const channelMsgs = [
      makeChannelMessage({
        id: 'prompt-1',
        kind: 'agent_message',
        text: 'Reading files',
        timestamp,
      }),
    ];
    const convMsgs = [
      makeConversationMessage({
        id: 'conv-tool-1',
        createdAt: timestamp.getTime(),
        parts: [
          {
            id: 'tool-1',
            type: 'tool-call',
            toolName: 'bash',
            toolStatus: 'completed',
            toolOutput: 'done',
          },
        ],
      }),
    ];

    const result = mergeMessages(channelMsgs, convMsgs);

    expect(result).toHaveLength(2);
    expect(result.some((message) => message.id === 'conv-tool-1')).toBe(true);
  });

  it('removes messages that become empty after hidden-content filtering', () => {
    const channelMsgs = [
      makeChannelMessage({
        id: 'hidden-1',
        kind: 'agent_message',
        text: '<system-reminder>Internal only</system-reminder>',
      }),
      makeChannelMessage({
        id: 'visible-1',
        kind: 'agent_message',
        text: 'Still visible',
        timestamp: new Date('2026-04-11T10:00:01.000Z'),
      }),
    ];

    const result = mergeMessages(channelMsgs, [], undefined, {
      hideSystemReminders: true,
      hideDocInjections: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('visible-1');
  });
});
