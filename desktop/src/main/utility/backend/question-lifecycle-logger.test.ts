import { describe, expect, it } from 'vitest';
import { formatQuestionLifecycleLog } from './question-lifecycle-logger';

describe('question-lifecycle-logger', () => {
  it('formats asked lifecycle events', () => {
    expect(
      formatQuestionLifecycleLog({
        kind: 'asked',
        requestId: 'que_123',
        sessionId: 'ses_123',
        questionCount: 2,
      }),
    ).toBe('question_lifecycle kind=asked requestId=que_123 questionCount=2');
  });

  it('formats answered lifecycle events with answers count', () => {
    expect(
      formatQuestionLifecycleLog({
        kind: 'answered',
        requestId: 'que_123',
        sessionId: 'ses_123',
        answerCount: 1,
      }),
    ).toBe('question_lifecycle kind=answered requestId=que_123 answerCount=1');
  });

  it('formats rejected and expired lifecycle events', () => {
    expect(
      formatQuestionLifecycleLog({
        kind: 'rejected',
        requestId: 'que_123',
        sessionId: 'ses_123',
      }),
    ).toBe('question_lifecycle kind=rejected requestId=que_123');
    expect(
      formatQuestionLifecycleLog({
        kind: 'expired',
        requestId: 'que_123',
        sessionId: 'ses_123',
        reason: 'abort',
      }),
    ).toBe('question_lifecycle kind=expired requestId=que_123 reason=abort');
  });
});
