import { describe, expect, it } from 'vitest';
import {
  CHAT_VIRTUALIZATION_THRESHOLD,
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
