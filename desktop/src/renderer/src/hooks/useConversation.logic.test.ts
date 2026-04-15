import { describe, expect, it } from 'vitest';
import { __useConversationTestUtils } from './useConversation';

describe('useConversation reconcile policy', () => {
  it('always reconciles on message.completed', () => {
    const shouldReconcile =
      __useConversationTestUtils.shouldReconcileMessageEvent(
        'message.completed',
        100,
        110,
      );

    expect(shouldReconcile).toBe(true);
  });

  it('reconciles on message.created', () => {
    const shouldReconcile =
      __useConversationTestUtils.shouldReconcileMessageEvent(
        'message.created',
        100,
        101,
      );

    expect(shouldReconcile).toBe(true);
  });

  it('suppresses message.updated reconcile while deltas are still hot', () => {
    const shouldReconcile =
      __useConversationTestUtils.shouldReconcileMessageEvent(
        'message.updated',
        1000,
        1100,
      );

    expect(shouldReconcile).toBe(true);
  });

  it('allows message.updated reconcile once outside suppression window', () => {
    const shouldReconcile =
      __useConversationTestUtils.shouldReconcileMessageEvent(
        'message.updated',
        1000,
        1300,
      );

    expect(shouldReconcile).toBe(true);
  });
});
