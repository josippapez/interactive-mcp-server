import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../../preload/api/types';
import { conversationToUnified, mergeMessages } from './unified-message';

function assistantMessage(
  id: string,
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id,
    sessionId: 'ses_1',
    role: 'assistant',
    parts: [{ id: `${id}_text`, type: 'text', text: `answer ${id}` }],
    modelId: 'gpt-5.5',
    providerId: 'github-copilot',
    agent: 'build',
    variant: 'max',
    createdAt: id === 'msg_1' ? 100 : 101,
    ...overrides,
  };
}

function userMessage(
  id: string,
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id,
    sessionId: 'ses_1',
    role: 'user',
    parts: [{ id: `${id}_text`, type: 'text', text: `prompt ${id}` }],
    modelId: 'gpt-5.5',
    providerId: 'github-copilot',
    agent: 'build',
    variant: 'max',
    createdAt: id === 'user_1' ? 99 : 100,
    ...overrides,
  };
}

describe('mergeMessages', () => {
  it('inherits assistant effort from the parent user turn', () => {
    const messages = mergeMessages(
      [],
      [
        userMessage('user_1'),
        assistantMessage('msg_1', {
          parentId: 'user_1',
          variant: undefined,
        }),
      ],
    );

    expect(messages.find((message) => message.id === 'msg_1')?.variant).toBe(
      'max',
    );
  });

  it('inherits effort even when the parent user message is hidden by channel dedupe', () => {
    const messages = mergeMessages(
      [
        {
          id: 'channel_1',
          sessionId: 'ses_1',
          kind: 'outbound',
          text: 'prompt user_1',
          timestamp: new Date(98),
        },
      ],
      [
        userMessage('user_1'),
        assistantMessage('msg_1', {
          parentId: 'user_1',
          variant: undefined,
        }),
      ],
    );

    expect(messages.find((message) => message.id === 'msg_1')?.variant).toBe(
      'max',
    );
  });

  it('does not inherit assistant effort from unrelated prior assistant messages', () => {
    const messages = mergeMessages(
      [],
      [
        assistantMessage('msg_1'),
        assistantMessage('msg_2', {
          parentId: 'missing-user',
          variant: undefined,
        }),
      ],
    );

    expect(messages.find((message) => message.id === 'msg_2')?.variant).toBe(
      undefined,
    );
  });

  it('falls back to the latest prior user turn effort when parent metadata is missing', () => {
    const messages = mergeMessages(
      [],
      [
        userMessage('user_1', { createdAt: 100, variant: 'high' }),
        assistantMessage('msg_1', {
          createdAt: 110,
          parentId: 'missing-user',
          variant: undefined,
        }),
      ],
    );

    expect(messages.find((message) => message.id === 'msg_1')?.variant).toBe(
      'high',
    );
  });

  it('does not use later user turn effort for earlier assistant messages', () => {
    const messages = mergeMessages(
      [],
      [
        assistantMessage('msg_1', {
          createdAt: 100,
          parentId: 'missing-user',
          variant: undefined,
        }),
        userMessage('user_1', { createdAt: 110, variant: 'high' }),
      ],
    );

    expect(messages.find((message) => message.id === 'msg_1')?.variant).toBe(
      undefined,
    );
  });

  it('hides send_message tool echoes when the channel message has a nearby timestamp', () => {
    const messages = mergeMessages(
      [
        {
          id: 'channel_agent_message',
          sessionId: 'ses_1',
          kind: 'agent_message',
          text: 'You have a few Shopify-native ways to handle this.',
          timestamp: new Date(1000),
        },
      ],
      [
        assistantMessage('tool_echo', {
          createdAt: 1015,
          parts: [
            {
              id: 'tool_1',
              type: 'tool-call',
              toolName: 'send_message',
              toolStatus: 'completed',
              toolInput: {
                message: 'You have a few Shopify-native ways to handle this.',
              },
              toolOutput: '{"ok":true}',
            },
          ],
        }),
      ],
    );

    expect(messages.map((message) => message.id)).toEqual([
      'channel_agent_message',
    ]);
  });
});

describe('conversationToUnified', () => {
  it('hides synthetic and ignored text parts', () => {
    const unified = conversationToUnified(
      userMessage('user_1', {
        parts: [
          { id: 'synthetic', type: 'text', text: 'hidden', synthetic: true },
          { id: 'ignored', type: 'text', text: 'ignored', ignored: true },
          { id: 'visible', type: 'text', text: 'visible' },
        ],
      }),
    );

    expect(unified.text).toBe('visible');
    expect(unified.hiddenTextPartCount).toBe(2);
  });

  it('converts data file parts to attachments', () => {
    const unified = conversationToUnified(
      userMessage('user_1', {
        parts: [
          {
            id: 'file_1',
            type: 'file',
            filename: 'image.png',
            mediaType: 'image/png',
            fileUrl: 'data:image/png;base64,aW1hZ2U=',
          },
        ],
      }),
    );

    expect(unified.attachments).toEqual([
      {
        data: 'aW1hZ2U=',
        mimeType: 'image/png',
        name: 'image.png',
        size: 8,
      },
    ]);
    expect(unified.fileParts).toEqual([
      {
        name: 'image.png',
        mimeType: 'image/png',
        url: 'data:image/png;base64,aW1hZ2U=',
      },
    ]);
  });

  it('does not render metadata-only fallback text while streaming', () => {
    const unified = conversationToUnified(
      assistantMessage('msg_1', {
        parts: [],
        mode: 'build',
        finish: 'stop',
      }),
    );

    expect(unified.text).toBe('');
  });

  it('carries source links and tool titles', () => {
    const unified = conversationToUnified(
      assistantMessage('msg_1', {
        parts: [
          {
            id: 'source_1',
            type: 'source-url',
            sourceUrl: 'https://example.com/doc',
            sourceTitle: 'Docs',
          },
          {
            id: 'tool_1',
            type: 'tool-call',
            toolName: 'bash',
            toolTitle: 'Run tests',
            toolStatus: 'completed',
          },
        ],
      }),
    );

    expect(unified.sourceUrls).toEqual([
      { url: 'https://example.com/doc', title: 'Docs' },
    ]);
    expect(unified.toolCalls?.[0]?.title).toBe('Run tests');
  });

  it('carries assistant footer and error metadata', () => {
    const unified = conversationToUnified(
      assistantMessage('msg_1', {
        mode: 'build',
        finish: 'stop',
        error: 'Something failed',
        completedAt: 250,
        cost: 0.02,
        tokens: { input: 1, output: 2, reasoning: 0 },
      }),
    );

    expect(unified).toMatchObject({
      mode: 'build',
      finish: 'stop',
      error: 'Something failed',
      completedAt: 250,
      cost: 0.02,
      tokens: { input: 1, output: 2, reasoning: 0 },
    });
  });
});
