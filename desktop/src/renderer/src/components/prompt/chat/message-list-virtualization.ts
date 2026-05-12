export const CHAT_VIRTUALIZATION_THRESHOLD = 80;

export function shouldVirtualizeMessageList(input: {
  messageCount: number;
  isBusy: boolean;
}): boolean {
  return !input.isBusy && input.messageCount > CHAT_VIRTUALIZATION_THRESHOLD;
}
