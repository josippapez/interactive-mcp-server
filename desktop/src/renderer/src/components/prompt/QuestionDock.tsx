import React, { useMemo, useState } from 'react';
import type { PendingQuestion } from '../../types';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

type Props = {
  question: PendingQuestion;
  onReply: (requestId: string, answers: string[][], sessionID: string) => void;
  onReject: (requestId: string, sessionID: string) => void;
};

export default function QuestionDock({
  question,
  onReply,
  onReject,
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

    updateAnswers([label]);
  };

  const handleCustomChange = (value: string) => {
    setCustomAnswers((prev) => {
      const copy = [...prev];
      copy[currentIndex] = value;
      return copy;
    });

    const trimmed = value.trim();
    if (!trimmed) return;
    if (isMulti) {
      const withoutPrev = currentAnswers.filter(
        (item) => item !== (customAnswers[currentIndex] ?? '').trim(),
      );
      updateAnswers(
        withoutPrev.includes(trimmed) ? withoutPrev : [...withoutPrev, trimmed],
      );
      return;
    }
    updateAnswers([trimmed]);
  };

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
      const result = await saver(base64, file.type || 'image/png');
      if (!result) {
        setPasteNotice('Failed to save pasted image');
        return;
      }
      const inserted = result.url ?? result.absolutePath;
      const existing = customAnswers[currentIndex] ?? '';
      const separator = existing && !existing.endsWith('\n') ? '\n' : '';
      const next = `${existing}${separator}${inserted}\n`;
      handleCustomChange(next);
      const noticePrefix = result.url ? 'Image URL inserted' : 'Image saved';
      setPasteNotice(`${noticePrefix}: ${result.filename}`);
      window.setTimeout(() => setPasteNotice(null), 4000);
    };
    reader.readAsDataURL(file);
  };

  const hasMultipleQuestions = questions.length > 1;
  const isLastQuestion = currentIndex >= questions.length - 1;
  const currentAnswered =
    currentAnswers.length > 0 ||
    (customEnabled && customAnswer.trim().length > 0);

  return (
    <div className="relative z-10 flex max-h-[min(70vh,600px)] flex-col border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      {/* Header — pinned */}
      <div className="flex-none px-4 pt-3 pb-2">
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

        <p className="text-sm text-[var(--color-text)]">
          {currentQuestion.question}
        </p>
      </div>

      {/* Scrollable middle — options + custom answer */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="space-y-2">
          {currentQuestion.options.map((option) => {
            const picked = currentAnswers.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => handleOptionToggle(option.label)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  picked
                    ? 'border-[var(--color-agent)] bg-[var(--color-agent)]/10'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-agent)]/40'
                }`}
              >
                <div className="text-sm font-medium text-[var(--color-text)]">
                  {option.label}
                </div>
                {option.description && (
                  <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {option.description}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {customEnabled && (
          <div className="mt-3 pb-3">
            <Textarea
              value={customAnswer}
              onChange={(event) => handleCustomChange(event.target.value)}
              onPaste={handleCustomPaste}
              placeholder="Type your own answer (paste an image to attach)"
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
                const answersToSubmit = questions.map(
                  (_, index) => answers[index] ?? [],
                );
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
