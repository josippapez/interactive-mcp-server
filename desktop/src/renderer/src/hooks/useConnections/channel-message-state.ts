import type { ChannelMessage } from '../../types';

export const MAX_CHANNEL_MESSAGES = 500;

export function trimChannelMessages(
  messages: readonly ChannelMessage[],
): ChannelMessage[] {
  if (messages.length <= MAX_CHANNEL_MESSAGES) return [...messages];
  return messages.slice(messages.length - MAX_CHANNEL_MESSAGES);
}

export function appendChannelMessage(
  messages: readonly ChannelMessage[],
  message: ChannelMessage,
): ChannelMessage[] {
  if (messages.length < MAX_CHANNEL_MESSAGES) {
    return [...messages, message];
  }
  return [
    ...messages.slice(messages.length - MAX_CHANNEL_MESSAGES + 1),
    message,
  ];
}
