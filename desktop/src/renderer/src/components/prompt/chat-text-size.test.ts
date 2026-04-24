import { describe, expect, it } from 'vitest';
import {
  CHAT_TEXT_SIZE_OPTIONS,
  getChatTextSizeClasses,
  getToolCallLabelTextClass,
  getToolCallMonoTextClass,
  isChatTextSize,
  type ChatTextSize,
} from './chat-text-size';

describe('chat-text-size', () => {
  it('recognizes supported sizes', () => {
    expect(isChatTextSize('sm')).toBe(true);
    expect(isChatTextSize('md')).toBe(true);
    expect(isChatTextSize('lg')).toBe(true);
    expect(isChatTextSize('xl')).toBe(false);
  });

  it('returns stable class mappings for each size', () => {
    const classes = Object.fromEntries(
      CHAT_TEXT_SIZE_OPTIONS.map((size) => [
        size,
        getChatTextSizeClasses(size),
      ]),
    ) as Record<ChatTextSize, string>;

    expect(classes.sm).toContain('--chat-message-size:12px');
    expect(classes.md).toContain('--chat-message-size:13px');
    expect(classes.lg).toContain('--chat-message-size:15px');
  });

  it('exposes reusable tool-call text size helpers', () => {
    expect(getToolCallLabelTextClass()).toContain(
      'var(--chat-message-size,13px)-4px',
    );
    expect(getToolCallMonoTextClass()).toContain(
      'var(--chat-message-size,13px)-3px',
    );
  });
});
