import { describe, expect, it } from 'vitest';
import {
  CHAT_VIRTUALIZATION_THRESHOLD,
  shouldUseVirtualBottomScroll,
  shouldVirtualizeMessageList,
} from './message-list-virtualization';

describe('shouldVirtualizeMessageList', () => {
  it('keeps small chat windows on the plain list', () => {
    expect(
      shouldVirtualizeMessageList({
        messageCount: CHAT_VIRTUALIZATION_THRESHOLD,
        isBusy: false,
      }),
    ).toBe(false);
  });

  it('virtualizes long idle chat windows', () => {
    expect(
      shouldVirtualizeMessageList({
        messageCount: CHAT_VIRTUALIZATION_THRESHOLD + 1,
        isBusy: false,
      }),
    ).toBe(true);
  });

  it('keeps active streaming chats on the plain list', () => {
    expect(
      shouldVirtualizeMessageList({
        messageCount: CHAT_VIRTUALIZATION_THRESHOLD + 1,
        isBusy: true,
      }),
    ).toBe(false);
  });
});

describe('shouldUseVirtualBottomScroll', () => {
  it('uses virtual bottom scrolling only for non-empty virtualized lists', () => {
    expect(
      shouldUseVirtualBottomScroll({ isVirtualized: true, messageCount: 1 }),
    ).toBe(true);
  });

  it('falls back to DOM bottom scrolling for plain or empty lists', () => {
    expect(
      shouldUseVirtualBottomScroll({ isVirtualized: false, messageCount: 100 }),
    ).toBe(false);
    expect(
      shouldUseVirtualBottomScroll({ isVirtualized: true, messageCount: 0 }),
    ).toBe(false);
  });
});
