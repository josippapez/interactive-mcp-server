import React, { useMemo, useState } from 'react';
import type { PendingQuestion } from '../../types';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import MarkdownContent from '../MarkdownContent';
import {
  CUSTOM_ANSWER_LABEL,
  getQuestionDockCustomOptionState,
  getQuestionDockProgressLabel,
} from './question-dock-display';

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
  const [customEditing, setCustomEditing] = useState<boolean[]>([]);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  const questions = question.questions;
  const currentQuestion = questions[currentIndex];

  const currentAnswers = answers[currentIndex] ?? [];
  const customAnswer = customAnswers[currentIndex] ?? '';
  const isCustomEditing = customEditing[currentIndex] === true;
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
      setCustomEditing((prev) => {
        const copy = [...prev];
        copy[currentIndex] = false;
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

  const setCustomEditingForCurrent = (editing: boolean) => {
    setCustomEditing((prev) => {
      const copy = [...prev];
      copy[currentIndex] = editing;
      return copy;
    });
  };

  const handleCustomOpen = () => {
    setCustomEditingForCurrent(true);
    if (!isMulti && currentAnswers.length > 0) {
      updateAnswers([]);
    }
  };

  const handleCustomToggle = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const selected = customAnswer.trim().length > 0 || isCustomEditing;
    if (selected) {
      handleCustomChange('');
      setCustomEditingForCurrent(false);
      return;
    }

    handleCustomOpen();
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
    ? 'max-h-[min(70vh,620px)] w-full'
    : 'max-h-[min(70vh,620px)]';
  const customOptionState = getQuestionDockCustomOptionState({
    customEnabled,
    customAnswer,
    editing: isCustomEditing,
  });

  return (
    <div
      data-component="dock-prompt"
      data-kind="question"
      className={`relative z-10 flex min-h-0 flex-col ${sizeClass} ${className}`.trim()}
    >
      <div
        data-slot="question-body"
        className="flex min-h-0 flex-1 flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-2 pb-0 shadow-lg"
      >
        <div
          data-slot="question-header"
          className="flex items-center justify-between gap-3 px-2"
        >
          <div className="min-w-0">
            <div
              data-slot="question-header-title"
              className="truncate text-sm font-medium text-[var(--color-text)]"
            >
              {getQuestionDockProgressLabel(currentIndex, questions.length)}
            </div>
            {currentQuestion.header && (
              <div className="truncate text-xs text-[var(--color-text-muted)]">
                {currentQuestion.header}
              </div>
            )}
          </div>
          {hasMultipleQuestions && (
            <div className="flex flex-none items-center gap-2">
              <div data-slot="question-progress" className="flex gap-2">
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
                      data-slot="question-progress-segment"
                      data-active={active}
                      data-answered={answered}
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors after:h-0.5 after:w-4 after:rounded-full ${
                        active
                          ? 'after:bg-[var(--color-text)]'
                          : answered
                            ? 'after:bg-[var(--color-agent)] hover:after:bg-[var(--color-agent)]/80'
                            : 'after:bg-[var(--color-border)] hover:after:bg-[var(--color-text-muted)]'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div
          data-slot="question-content"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div
            data-slot="question-text"
            className="px-2 text-sm font-medium text-[var(--color-text)] [&_.prose]:text-sm [&_.prose_p]:!text-sm [&_.prose_p]:my-1 [&_[data-streamdown='code-block']]:my-2"
          >
            <MarkdownContent content={currentQuestion.question} />
          </div>

          {currentQuestion.options.length > 0 && (
            <div
              data-slot="question-hint"
              className="px-2 text-[13px] text-[var(--color-text-muted)]"
            >
              {isMulti ? 'Select all that apply' : 'Select one option'}
            </div>
          )}
          <div
            data-slot="question-options"
            className="mt-3 flex flex-col gap-1.5 overflow-y-auto px-px pb-2"
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
                  data-slot="question-option"
                  data-picked={picked}
                  className={`flex w-full items-start gap-3 rounded-md border px-2.5 py-2 text-left transition-colors ${
                    picked
                      ? 'border-transparent bg-[var(--color-agent)]/10 shadow-sm'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    data-slot="question-option-box"
                    data-type={isMulti ? 'checkbox' : 'radio'}
                    data-picked={picked}
                    className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center border p-0.5 ${
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
                  <span
                    data-slot="question-option-main"
                    className="min-w-0 flex-1"
                  >
                    <span
                      data-slot="option-label"
                      className="block text-sm font-medium text-[var(--color-text)]"
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <span
                        data-slot="option-description"
                        className="mt-0.5 block text-sm text-[var(--color-text-muted)]"
                      >
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {customOptionState.visible &&
              (isCustomEditing ? (
                <div
                  data-slot="question-option"
                  data-custom="true"
                  data-picked={customOptionState.picked}
                  role={isMulti ? 'checkbox' : 'radio'}
                  aria-checked={customOptionState.picked}
                  className="flex w-full items-start gap-3 rounded-md border border-transparent bg-[var(--color-agent)]/10 px-2.5 py-2 text-left shadow-sm"
                >
                  <button
                    type="button"
                    aria-label="Toggle custom answer"
                    onClick={handleCustomToggle}
                    className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border border-[var(--color-agent)] bg-[var(--color-agent)] text-white"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--color-text)]">
                      {CUSTOM_ANSWER_LABEL}
                    </span>
                    <Textarea
                      data-slot="question-custom-input"
                      value={customAnswer}
                      onChange={(event) =>
                        handleCustomChange(event.target.value)
                      }
                      onPaste={handleCustomPaste}
                      onBlur={() => setCustomEditingForCurrent(false)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setCustomEditingForCurrent(false);
                          return;
                        }

                        if (
                          event.key === 'Enter' &&
                          (event.ctrlKey || event.metaKey)
                        ) {
                          event.preventDefault();
                          if (hasMultipleQuestions && !isLastQuestion) {
                            setCurrentIndex((prev) =>
                              Math.min(questions.length - 1, prev + 1),
                            );
                          } else if (canSubmit) {
                            const answersToSubmit = buildAnswersForSubmit();
                            onReply(
                              question.requestId,
                              answersToSubmit,
                              question.sessionID,
                            );
                          }
                          return;
                        }

                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          setCustomEditingForCurrent(false);
                          return;
                        }
                      }}
                      placeholder="Type your own answer (paste an image to attach)"
                      className="mt-1 min-h-6 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-6 shadow-none outline-none focus-visible:ring-0"
                      autoFocus
                    />
                    {pasteNotice && (
                      <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {pasteNotice}
                      </div>
                    )}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  data-slot="question-option"
                  data-custom="true"
                  data-picked={customOptionState.picked}
                  role={isMulti ? 'checkbox' : 'radio'}
                  aria-checked={customOptionState.picked}
                  onClick={handleCustomOpen}
                  className={`flex w-full items-start gap-3 rounded-md border px-2.5 py-2 text-left transition-colors ${
                    customOptionState.picked
                      ? 'border-transparent bg-[var(--color-agent)]/10 shadow-sm'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center border ${
                      isMulti ? 'rounded-[3px]' : 'rounded-full'
                    } ${
                      customOptionState.picked
                        ? 'border-[var(--color-agent)] bg-[var(--color-agent)] text-white'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                    }`}
                  >
                    {customOptionState.picked &&
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
                      {CUSTOM_ANSWER_LABEL}
                    </span>
                    <span className="mt-0.5 block text-sm text-[var(--color-text-muted)]">
                      {customOptionState.description}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      </div>

      <div
        data-slot="question-footer"
        className="-mt-6 flex flex-none flex-wrap items-center justify-between gap-2 px-2 pt-8 pb-2"
      >
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={() => onReject(question.requestId, question.sessionID)}
          className="text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
        >
          Dismiss
        </Button>

        <div
          data-slot="question-footer-actions"
          className="flex items-center gap-2"
        >
          {hasMultipleQuestions && (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
            >
              Back
            </Button>
          )}
          {hasMultipleQuestions && !isLastQuestion ? (
            <Button
              type="button"
              size="lg"
              variant={currentAnswered ? 'secondary' : 'outline'}
              onClick={() =>
                setCurrentIndex((prev) =>
                  Math.min(questions.length - 1, prev + 1),
                )
              }
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
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
