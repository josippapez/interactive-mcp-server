import type { UnifiedMessage } from '../../../types/unified-message';

export function computeAutoScrollSignature(messages: UnifiedMessage[]): string {
  const count = messages.length;
  if (count === 0) return '0|';

  for (let index = count - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.source === 'conversation' && message.role === 'assistant') {
      const textLength = message.text?.length ?? 0;
      const reasoningLength = message.reasoning?.length ?? 0;
      return `${count}|${message.id}|${textLength}|${reasoningLength}`;
    }

    const textLength = message.text?.length ?? 0;
    return `${count}|${message.id}|${textLength}|0`;
  }

  return `${count}|`;
}
