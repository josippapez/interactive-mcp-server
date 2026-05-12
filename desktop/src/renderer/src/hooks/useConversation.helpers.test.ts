import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../../../preload/api/types';
import type { ConversationState } from '../store/conversation-reducer';
import {
  clearSnapshotCache,
  selectSession,
  shallowEqualMessage,
} from './useConversation.helpers';

function makeMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: overrides.id ?? 'msg-1',
    sessionId: overrides.sessionId ?? 'ses-1',
    role: overrides.role ?? 'assistant',
    parts: overrides.parts ?? [],
    modelId: overrides.modelId ?? 'gpt-5.4',
    providerId: overrides.providerId ?? 'opencode',
    agent: overrides.agent ?? 'main',
    mode: overrides.mode,
    variant: overrides.variant,
    createdAt: overrides.createdAt ?? 1,
    completedAt: overrides.completedAt,
    tokens: overrides.tokens,
    cost: overrides.cost,
    path: overrides.path,
    parentId: overrides.parentId,
  };
}

function makeState(message: ConversationMessage): ConversationState {
  return {
    messages: { [message.sessionId]: [message] },
    parts: {},
    status: { [message.sessionId]: 'idle' },
    todos: {},
    contextUsage: {},
    sessionSideChannels: {},
    vcsBranch: null,
    lastFileEdit: null,
    lastSeq: 0,
  };
}

describe('useConversation.helpers', () => {
  afterEach(() => {
    clearSnapshotCache();
  });

  it('treats reasoning variant changes as message changes', () => {
    const base = makeMessage({ variant: undefined });
    const updated = makeMessage({ variant: 'high' });

    expect(shallowEqualMessage(base, updated)).toBe(false);
  });

  it('refreshes joined message objects when reasoning variant appears later', () => {
    const initial = makeState(makeMessage({ variant: undefined }));
    const initialSnapshot = selectSession(initial, 'ses-1');

    const updated = makeState(makeMessage({ variant: 'high' }));
    const updatedSnapshot = selectSession(updated, 'ses-1');

    expect(updatedSnapshot.messages[0]).not.toBe(initialSnapshot.messages[0]);
    expect(updatedSnapshot.messages[0].variant).toBe('high');
  });

  it('reuses snapshots when unrelated session parts change', () => {
    const message = makeMessage({ id: 'msg-1', sessionId: 'ses-1' });
    const part = { id: 'part-1', type: 'text', text: 'hello' };
    const initial: ConversationState = {
      ...makeState(message),
      parts: { 'msg-1': [part] },
    };

    const initialSnapshot = selectSession(initial, 'ses-1');
    const updatedSnapshot = selectSession(
      {
        ...initial,
        parts: { ...initial.parts, unrelated: [] },
      },
      'ses-1',
    );

    expect(updatedSnapshot).toBe(initialSnapshot);
  });
});
