export const CHAT_TEXT_SIZE_OPTIONS = ['sm', 'md', 'lg'] as const;

export type ChatTextSize = (typeof CHAT_TEXT_SIZE_OPTIONS)[number];

export function isChatTextSize(value: string): value is ChatTextSize {
  return (CHAT_TEXT_SIZE_OPTIONS as readonly string[]).includes(value);
}

export function getChatTextSizeClasses(size: ChatTextSize): string {
  switch (size) {
    case 'sm':
      return '[--chat-message-size:15px] [--chat-message-line-height:1.7]';
    case 'lg':
      return '[--chat-message-size:18px] [--chat-message-line-height:1.78]';
    case 'md':
    default:
      return '[--chat-message-size:16px] [--chat-message-line-height:1.72]';
  }
}

export function getToolCallLabelTextClass(): string {
  return 'text-[11px]';
}

export function getToolCallMonoTextClass(): string {
  return 'text-[12px]';
}
