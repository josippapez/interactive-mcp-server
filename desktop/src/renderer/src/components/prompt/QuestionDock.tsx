import React, { useMemo, useState } from 'react';
import type { PendingQuestion } from '../../types';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import MarkdownContent from '../MarkdownContent';

type Props = {
  question: PendingQuestion;
  onReply: (requestId: string, answers: string[][], sessionID: string) => void;
  onReject: (requestId: string, sessionID: string) => void;
  fill?: boolean;
  className?: string;
};

export default function QuestionDock({
  question,
  onReply,
  onReject,
  fill = false,
  className = '',
}: Props): React.ReactElement | null {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[][]>([]);
  const [customAnswers, setCustomAnswers] = useState<string[]>([]);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  const questions = question.questions;
  const currentQuestion = questions[currentIndex];

  const currentAnswers = answers[currentIndex] ?? [];
  const customAnswer = customAnswers[currentIndex] ?? '';
  const customEnabled = currentQuestion?.custom !== false;
  const isMulti = currentQuestion?.multiple === true;

  const canSubmit = useMemo(
    () =>
      questions.every((item, index) => {
        const selected = answers[index] ?? [];
        const custom = (customAnswers[index] ?? '').trim();
        return (
          selected.length > 0 || (item.custom !== false && custom.length > 0)
        );
      }),
    [answers, customAnswers, questions],
  );

  if (!currentQuestion) return null;

  const updateAnswers = (next: string[]) => {
    setAnswers((prev) => {
      const copy = [...prev];
      copy[currentIndex] = next;
      return copy;
    });
  };

  const handleOptionToggle = (label: string) => {
    if (isMulti) {
      updateAnswers(
        currentAnswers.includes(label)
          ? currentAnswers.filter((item) => item !== label)
          : [...currentAnswers, label],
      );
      return;
    }

    // Single-select: clicking the already-selected option deselects it,
    // matching native radio-button-pair UX expectations and allowing the
    // user to clear their choice without reloading the prompt.
    const next = currentAnswers.includes(label) ? [] : [label];
    updateAnswers(next);
    // Mutually exclusive: selecting a predefined option clears any
    // typed custom answer for this question.
    if (next.length > 0) {
      setCustomAnswers((prev) => {
        const copy = [...prev];
        copy[currentIndex] = '';
        return copy;
      });
    }
  };

  const handleCustomChange = (value: string) => {
    setCustomAnswers((prev) => {
      const copy = [...prev];
      copy[currentIndex] = value;
      return copy;
    });
    // Single-select prompts treat predefined option and custom answer as
    // mutually exclusive: typing a non-empty custom answer clears the
    // selected option. Multi-select keeps both since custom acts as one
    // additional pick alongside other selections.
    if (!isMulti && value.trim().length > 0 && currentAnswers.length > 0) {
      updateAnswers([]);
    }
  };

  const buildAnswersForSubmit = (): string[][] =>
    questions.map((item, index) => {
      const selected = answers[index] ?? [];
      const custom = (customAnswers[index] ?? '').trim();
      const questionIsMulti = item.multiple === true;
      // Single-select: predefined option and custom answer are mutually
      // exclusive. If both somehow exist, the predefined selection wins.
      if (!questionIsMulti) {
        if (selected.length > 0) return selected;
        if (custom) return [custom];
        return [];
      }
      // Multi-select: merge custom as an additional pick.
      if (!custom) return selected;
      if (selected.includes(custom)) return selected;
      return [...selected, custom];
    });

  const handleCustomPaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      if (!base64) return;
      const saver = (
        window.api as unknown as {
          saveClipboardAttachment?: (
            sessionKey: string,
            data: string,
            mimeType: string,
          ) => Promise<{
            filename: string;
            absolutePath: string;
            url: string | null;
          } | null>;
        }
      ).saveClipboardAttachment;
      if (!saver) {
        setPasteNotice('Image paste not supported in this build');
        return;
      }
      const result = await saver(
        question.sessionID,
        base64,
        file.type || 'image/png',
      );
      if (!result) {
        setPasteNotice('Failed to save pasted image');
        return;
      }
      const inserted = result.absolutePath;
      const existing = customAnswers[currentIndex] ?? '';
      const separator = existing && !existing.endsWith('\n') ? '\n' : '';
      const next = `${existing}${separator}${inserted}\n`;
      handleCustomChange(next);
      setPasteNotice(`Image saved: ${result.filename}`);
      window.setTimeout(() => setPasteNotice(null), 4000);
    };
    reader.readAsDataURL(file);
  };

  const hasMultipleQuestions = questions.length > 1;
  const isLastQuestion = currentIndex >= questions.length - 1;
  const currentAnswered =
    currentAnswers.length > 0 ||
    (customEnabled && customAnswer.trim().length > 0);
  const sizeClass = fill
    ? 'h-full max-h-none w-full border-t-0'
    : 'max-h-[min(70vh,600px)] border-t';

  return (
    <div
      className={`relative z-10 flex flex-col border-[var(--color-border)] bg-[var(--color-surface-alt)] ${sizeClass} ${className}`.trim()}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-agent)]">
              Question
            </div>
            <div className="truncate text-sm font-medium text-[var(--color-text)]">
              {currentQuestion.header}
            </div>
          </div>
          {hasMultipleQuestions && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {questions.map((_, index) => {
                  const answered =
                    (answers[index]?.length ?? 0) > 0 ||
                    (customAnswers[index] ?? '').trim().length > 0;
                  const active = index === currentIndex;
                  return (
                    <button
                      key={index}
                      type="button"
                      aria-label={`Go to question ${index + 1}${answered ? ' (answered)' : ''}`}
                      aria-current={active ? 'step' : undefined}
                      onClick={() => setCurrentIndex(index)}
                      className={`h-2 w-6 rounded-full transition-colors ${
                        active
                          ? 'bg-[var(--color-agent)]'
                          : answered
                            ? 'bg-[var(--color-agent)]/50 hover:bg-[var(--color-agent)]/70'
                            : 'bg-[var(--color-border)] hover:bg-[var(--color-text-muted)]'
                      }`}
                    />
                  );
                })}
              </div>
              <div className="text-xs tabular-nums text-[var(--color-text-muted)]">
                {currentIndex + 1} / {questions.length}
              </div>
            </div>
          )}
        </div>

        <div className="text-sm text-[var(--color-text)] [&_.prose]:text-sm [&_.prose_p]:!text-sm [&_.prose_p]:my-1 [&_[data-streamdown='code-block']]:my-2">
          <MarkdownContent content={currentQuestion.question} />
        </div>

        {currentQuestion.options.length > 0 && (
          <div className="mt-3 mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {isMulti ? 'Select all that apply' : 'Select one'}
          </div>
        )}
        <div
          className="space-y-2"
          role={isMulti ? 'group' : 'radiogroup'}
          aria-label={isMulti ? 'Select all that apply' : 'Select one option'}
        >
          {currentQuestion.options.map((option) => {
            const picked = currentAnswers.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role={isMulti ? 'checkbox' : 'radio'}
                aria-checked={picked}
                onClick={() => handleOptionToggle(option.label)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  picked
                    ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-agent)]/40'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center border ${
                    isMulti ? 'rounded-[3px]' : 'rounded-full'
                  } ${
                    picked
                      ? 'border-[var(--color-agent)] bg-[var(--color-agent)] text-white'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                  }`}
                >
                  {picked &&
                    (isMulti ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
                      </svg>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--color-text)]">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {customEnabled && (
          <div className="mt-3 pb-3">
            {!isMulti && currentQuestion.options.length > 0 && (
              <div className="mb-2 flex items-center gap-3">
                <button
                  type="button"
                  role="radio"
                  aria-checked={customAnswer.trim().length > 0}
                  aria-label="Custom answer"
                  onClick={() => {
                    if (customAnswer.trim().length > 0) {
                      // Clear the custom answer (deselect this radio).
                      handleCustomChange('');
                    }
                  }}
                  className="flex items-center gap-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                      customAnswer.trim().length > 0
                        ? 'border-[var(--color-agent)] bg-[var(--color-agent)] text-white'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                    }`}
                  >
                    {customAnswer.trim().length > 0 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </span>
                  <span className="text-sm font-medium text-[var(--color-text)]">
                    Type your own answer
                  </span>
                </button>
              </div>
            )}
            <Textarea
              value={customAnswer}
              onChange={(event) => handleCustomChange(event.target.value)}
              onPaste={handleCustomPaste}
              onKeyDown={(event) => {
                // Ctrl+Enter or Cmd+Enter to submit/next
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (hasMultipleQuestions && !isLastQuestion) {
                    // Go to next question
                    setCurrentIndex((prev) =>
                      Math.min(questions.length - 1, prev + 1),
                    );
                  } else if (canSubmit) {
                    // Submit all answers
                    const answersToSubmit = buildAnswersForSubmit();
                    onReply(
                      question.requestId,
                      answersToSubmit,
                      question.sessionID,
                    );
                  }
                }
              }}
              placeholder="Type your own answer (paste an image to attach) · Ctrl+Enter to submit"
              className="min-h-[72px]"
            />
            {pasteNotice && (
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                {pasteNotice}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — pinned */}
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onReject(question.requestId, question.sessionID)}
          className="text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
        >
          Reject
        </Button>

        <div className="flex items-center gap-2">
          {hasMultipleQuestions && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
            >
              Previous
            </Button>
          )}
          {hasMultipleQuestions && !isLastQuestion ? (
            <Button
              type="button"
              size="sm"
              variant={currentAnswered ? 'default' : 'outline'}
              onClick={() =>
                setCurrentIndex((prev) =>
                  Math.min(questions.length - 1, prev + 1),
                )
              }
            >
              Next
              <span aria-hidden className="ml-1">
                →
              </span>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const answersToSubmit = buildAnswersForSubmit();
                onReply(
                  question.requestId,
                  answersToSubmit,
                  question.sessionID,
                );
              }}
              disabled={!canSubmit}
            >
              Submit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
