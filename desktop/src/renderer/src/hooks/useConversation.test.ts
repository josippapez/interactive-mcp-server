import { describe, expect, it } from 'vitest';
import { CONVERSATION_REST_SEED_LIMIT } from './useConversation';

describe('useConversation', () => {
  it('requests a large enough REST seed to reduce apparent history loss after pruning', () => {
    expect(CONVERSATION_REST_SEED_LIMIT).toBe(500);
  });
});
