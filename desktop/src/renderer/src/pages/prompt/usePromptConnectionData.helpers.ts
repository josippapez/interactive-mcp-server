import type {
  ConversationReviewDiff,
  ConversationState,
} from '../../store/conversation-reducer';
import type { ReviewDiffSource } from '../../../../preload';

const EMPTY_REVIEW_DIFFS: readonly ConversationReviewDiff[] = [];

export function selectReviewDiffs(
  state: ConversationState,
  providerSessionId: string | null,
): readonly ConversationReviewDiff[] {
  return providerSessionId
    ? (state.reviewDiffs[providerSessionId] ?? EMPTY_REVIEW_DIFFS)
    : EMPTY_REVIEW_DIFFS;
}

export function getReviewDiffSourceOptions(input: {
  vcsInfo: { branch: string | null; defaultBranch: string | null } | null;
}): ReviewDiffSource[] {
  const options: ReviewDiffSource[] = ['git'];
  if (
    input.vcsInfo?.branch &&
    input.vcsInfo.defaultBranch &&
    input.vcsInfo.branch !== input.vcsInfo.defaultBranch
  ) {
    options.push('branch');
  }
  options.push('turn');
  return options;
}

export function normalizeReviewDiffSource(
  source: ReviewDiffSource,
  options: readonly ReviewDiffSource[],
): ReviewDiffSource {
  return options.includes(source) ? source : (options[0] ?? 'turn');
}
