import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_REST_SEED_LIMIT,
  shouldCacheConversationSeedResult,
} from './useConversation';

describe('useConversation', () => {
  it('requests a large enough REST seed to reduce apparent history loss after pruning', () => {
    expect(CONVERSATION_REST_SEED_LIMIT).toBe(500);
  });

  it('does not cache an empty seed result so new sessions can retry after creation races', () => {
    expect(shouldCacheConversationSeedResult([])).toBe(false);
  });
});
