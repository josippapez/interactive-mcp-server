import { describe, expect, it } from 'vitest';
import type { ChannelMessage } from '../../types';
import {
  MAX_CHANNEL_MESSAGES,
  appendChannelMessage,
} from './channel-message-state';

function makeMessage(index: number): ChannelMessage {
  return {
    id: `msg-${index}`,
    kind: 'agent_message',
    text: `message ${index}`,
    timestamp: new Date(index),
  };
}

describe('channel-message-state', () => {
  it('keeps the newest channel messages when appending past the cap', () => {
    const existing = Array.from({ length: MAX_CHANNEL_MESSAGES }, (_, index) =>
      makeMessage(index),
    );

    const next = appendChannelMessage(
      existing,
      makeMessage(MAX_CHANNEL_MESSAGES),
    );

    expect(next).toHaveLength(MAX_CHANNEL_MESSAGES);
    expect(next[0]?.id).toBe('msg-1');
    expect(next.at(-1)?.id).toBe(`msg-${MAX_CHANNEL_MESSAGES}`);
  });
});
