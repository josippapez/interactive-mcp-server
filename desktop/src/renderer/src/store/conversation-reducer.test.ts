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
  _resetConversationStoreForTest,
  replaceSessionStatusSnapshot,
  seedMessages,
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

  it('creates assistant metadata from session.next.step.started before message updates arrive', () => {
    const updated = applyConversationEvent(initialConversationState, {
      type: 'session.next.step.started',
      sessionId: 'ses_1',
      messageId: 'msg_step',
      agent: 'build',
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
      timestamp: 250,
    });

    expect(updated.messages.ses_1[0]).toMatchObject({
      id: 'msg_step',
      role: 'assistant',
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
      agent: 'build',
    });
    expect(updated.sessionSideChannels.ses_1.model).toEqual({
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
    });
  });

  it('preserves step-started variant when later message updates omit it', () => {
    const seeded = applyConversationEvent(initialConversationState, {
      type: 'session.next.step.started',
      sessionId: 'ses_1',
      messageId: 'msg_step',
      agent: 'build',
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
      timestamp: 250,
    });

    const updated = applyConversationEvent(seeded, {
      type: 'message.updated',
      sessionId: 'ses_1',
      message: assistantMessage({
        id: 'msg_step',
        modelId: undefined,
        providerId: undefined,
        variant: undefined,
      }),
    });

    expect(updated.messages.ses_1[0]).toMatchObject({
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
    });
  });

  it('lets session.next.step.started correct stale existing message metadata', () => {
    const seeded = applyConversationEvent(initialConversationState, {
      type: 'message.updated',
      sessionId: 'ses_1',
      message: assistantMessage({ id: 'msg_step', variant: 'low' }),
    });

    const updated = applyConversationEvent(seeded, {
      type: 'session.next.step.started',
      sessionId: 'ses_1',
      messageId: 'msg_step',
      agent: 'build',
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
      timestamp: 250,
    });

    expect(updated.messages.ses_1[0]).toMatchObject({
      modelId: 'claude-opus-4.6',
      providerId: 'github-copilot',
      variant: 'xhigh',
    });
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

  it('evicts older seeded sessions so switching chats cannot retain every full history', () => {
    _resetConversationStoreForTest();

    for (let index = 0; index < 10; index += 1) {
      const sessionId = `ses_${index}`;
      seedMessages(sessionId, [
        assistantMessage({
          id: `msg_${index}`,
          sessionId,
          createdAt: index,
          parts: [{ id: `part_${index}`, type: 'text', text: 'message' }],
        }),
      ]);
    }

    expect(Object.keys(conversationStore.state.messages)).toEqual([
      'ses_2',
      'ses_3',
      'ses_4',
      'ses_5',
      'ses_6',
      'ses_7',
      'ses_8',
      'ses_9',
    ]);
    expect(conversationStore.state.parts.msg_0).toBeUndefined();
    expect(conversationStore.state.parts.msg_9).toBeDefined();
  });
});
