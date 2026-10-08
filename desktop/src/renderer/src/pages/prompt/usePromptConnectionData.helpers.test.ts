import { describe, expect, it } from 'vitest';
import type { ConversationState } from '../../store/conversation-reducer';
import {
  getReviewDiffSourceOptions,
  normalizeReviewDiffSource,
  selectReviewDiffs,
} from './usePromptConnectionData.helpers';

function makeState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return {
    messages: {},
    parts: {},
    status: {},
    todos: {},
    contextUsage: {},
    reviewDiffs: {},
    sessionSideChannels: {},
    vcsBranch: null,
    lastFileEdit: null,
    lastSeq: 0,
    ...overrides,
  };
}

describe('usePromptConnectionData helpers', () => {
  it('returns a stable empty review diff array when no session is selected', () => {
    const state = makeState();

    expect(selectReviewDiffs(state, null)).toBe(selectReviewDiffs(state, null));
  });

  it('returns a stable empty review diff array when the session has no diffs', () => {
    const state = makeState();

    expect(selectReviewDiffs(state, 'ses_1')).toBe(
      selectReviewDiffs(state, 'ses_1'),
    );
  });

  it('returns the stored review diff array when present', () => {
    const diffs = [{ file: 'src/App.tsx', additions: 1, deletions: 0 }];

    expect(
      selectReviewDiffs(makeState({ reviewDiffs: { ses_1: diffs } }), 'ses_1'),
    ).toBe(diffs);
  });

  it('includes branch review source only when branch differs from default', () => {
    expect(
      getReviewDiffSourceOptions({
        vcsInfo: { branch: 'feature', defaultBranch: 'main' },
      }),
    ).toEqual(['git', 'branch', 'turn']);

    expect(
      getReviewDiffSourceOptions({
        vcsInfo: { branch: 'main', defaultBranch: 'main' },
      }),
    ).toEqual(['git', 'turn']);
  });

  it('normalizes unavailable review source selections', () => {
    expect(normalizeReviewDiffSource('branch', ['git', 'turn'])).toBe('git');
    expect(normalizeReviewDiffSource('turn', ['git', 'turn'])).toBe('turn');
  });
});
