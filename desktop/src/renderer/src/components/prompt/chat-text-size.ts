export const CHAT_TEXT_SIZE_OPTIONS = ['sm', 'md', 'lg'] as const;

export type ChatTextSize = (typeof CHAT_TEXT_SIZE_OPTIONS)[number];

export function isChatTextSize(value: string): value is ChatTextSize {
  return (CHAT_TEXT_SIZE_OPTIONS as readonly string[]).includes(value);
}

export function getChatTextSizeClasses(size: ChatTextSize): string {
  switch (size) {
    case 'sm':
      return '[--chat-message-size:12px] [--chat-message-line-height:1.55]';
    case 'lg':
      return '[--chat-message-size:15px] [--chat-message-line-height:1.7]';
    case 'md':
    default:
      return '[--chat-message-size:13px] [--chat-message-line-height:1.6]';
  }
}

export function getToolCallLabelTextClass(): string {
  return 'text-[calc(var(--chat-message-size,13px)-4px)]';
}

export function getToolCallMonoTextClass(): string {
  return 'text-[calc(var(--chat-message-size,13px)-3px)]';
}
