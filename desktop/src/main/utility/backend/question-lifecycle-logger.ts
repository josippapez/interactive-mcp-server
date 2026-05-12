export type QuestionLifecycleEvent = {
  kind: 'asked' | 'answered' | 'rejected' | 'expired' | 'displayed' | 'cleared';
  requestId: string;
  sessionId: string;
  questionCount?: number;
  answerCount?: number;
  reason?: string;
};

export function formatQuestionLifecycleLog(
  event: QuestionLifecycleEvent,
): string {
  const parts = [
    'question_lifecycle',
    `kind=${event.kind}`,
    `requestId=${event.requestId}`,
  ];
  if (typeof event.questionCount === 'number') {
    parts.push(`questionCount=${event.questionCount}`);
  }
  if (typeof event.answerCount === 'number') {
    parts.push(`answerCount=${event.answerCount}`);
  }
  if (event.reason) {
    parts.push(`reason=${event.reason}`);
  }
  return parts.join(' ');
}
