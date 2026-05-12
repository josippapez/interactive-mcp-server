import { describe, expect, it } from 'vitest';
import type {
  ConversationMessage,
  ConversationMessagePart,
} from '../../../preload/api/types';
import {
  applyConversationEvent,
  initialConversationState,
  type ConversationSessionStatus,
  seedConversationMessages,
} from './conversation-reducer';
import {
  conversationStore,
  replaceSessionStatusSnapshot,
  seedSessionStatus,
} from './conversation-store';

function assistantMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 'msg_1',
    sessionId: 'ses_1',
    role: 'assistant',
    parts: [],
    modelId: 'gpt-5.5',
    providerId: 'github-copilot',
    agent: 'build',
    variant: 'max',
    createdAt: 100,
    ...overrides,
  };
}

function toolPart(
  overrides: Partial<ConversationMessagePart> = {},
): ConversationMessagePart {
  return {
    id: 'part_1',
    type: 'tool-call',
    toolName: 'bash',
    toolCallId: 'call_1',
    toolInput: { command: 'npm test' },
    toolStatus: 'running',
    ...overrides,
  };
}

describe('conversation-reducer', () => {
  it('preserves existing message variant when later updates omit it', () => {
    const seeded = applyConversationEvent(initialConversationState, {
      type: 'message.updated',
      sessionId: 'ses_1',
      message: assistantMessage(),
    });

    const updated = applyConversationEvent(seeded, {
      type: 'message.updated',
      sessionId: 'ses_1',
      message: assistantMessage({ variant: undefined }),
    });

    expect(updated.messages.ses_1[0].variant).toBe('max');
  });

  it('merges REST seed history with already streamed live messages', () => {
    const live = applyConversationEvent(initialConversationState, {
      type: 'message.updated',
      sessionId: 'ses_1',
      message: assistantMessage({ id: 'msg_3', createdAt: 300 }),
    });

    const seeded = seedConversationMessages(live, 'ses_1', [
      assistantMessage({ id: 'msg_1', createdAt: 100 }),
      assistantMessage({ id: 'msg_2', createdAt: 200 }),
    ]);

    expect(seeded.messages.ses_1.map((message) => message.id)).toEqual([
      'msg_1',
      'msg_2',
      'msg_3',
    ]);
  });

  it('applies session.next.tool.progress to an existing running tool part only', () => {
    const seeded = applyConversationEvent(initialConversationState, {
      type: 'message.part.updated',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      part: toolPart(),
    });

    const updated = applyConversationEvent(seeded, {
      type: 'session.next.tool.progress',
      sessionId: 'ses_1',
      callId: 'call_1',
      structured: { phase: 'install' },
      content: [{ type: 'text', text: 'Installing dependencies' }],
      timestamp: 200,
    });

    expect(updated.parts.msg_1[0].toolOutput).toBe('Installing dependencies');
    expect(updated.sessionSideChannels.ses_1).toBeUndefined();
  });

  it('does not let stale session.next.tool.progress overwrite a completed tool', () => {
    const seeded = applyConversationEvent(initialConversationState, {
      type: 'message.part.updated',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      part: toolPart({ toolStatus: 'completed', toolOutput: 'Final result' }),
    });

    const updated = applyConversationEvent(seeded, {
      type: 'session.next.tool.progress',
      sessionId: 'ses_1',
      callId: 'call_1',
      structured: { phase: 'late' },
      content: [{ type: 'text', text: 'Late progress' }],
      timestamp: 300,
    });

    expect(updated.parts.msg_1[0].toolOutput).toBe('Final result');
    expect(updated.sessionSideChannels.ses_1).toBeUndefined();
  });
});

describe('conversation-store status snapshot', () => {
  it('removes stale busy statuses missing from the latest REST snapshot', () => {
    conversationStore.setState(initialConversationState);
    seedSessionStatus('ses_stale', 'streaming');
    seedSessionStatus('ses_current', 'streaming');

    replaceSessionStatusSnapshot({
      ses_current: 'idle' satisfies ConversationSessionStatus,
    });

    expect(conversationStore.state.status).toEqual({ ses_current: 'idle' });
  });
});
