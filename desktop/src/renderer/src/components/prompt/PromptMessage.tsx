import { memo } from 'react';
import type { PromptData } from '../../types';
import { formatTime } from '../../lib/formatters';
import MarkdownContent from '../MarkdownContent';

function getPromptBannerText(prompt: PromptData): string {
  return prompt.message.trim();
}

type Props = {
  prompt: PromptData;
  secondsLeft: number | null;
};

const PromptMessage = memo(function PromptMessage({
  prompt,
  secondsLeft,
}: Props): React.ReactElement | null {
  const promptText = getPromptBannerText(prompt);
  if (!prompt.projectName && !promptText && secondsLeft === null) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      <div className="flex items-center gap-3">
        {prompt.projectName && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-sm bg-[var(--color-agent)]/10 text-[var(--color-agent)] text-xs">
            {prompt.projectName}
          </span>
        )}
        {secondsLeft !== null && (
          <span
            className={`ml-auto shrink-0 px-1.5 py-0.5 rounded-sm text-xs font-mono ${
              secondsLeft === 0
                ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                : secondsLeft <= 60
                  ? 'bg-[#aaaa00]/10 text-[var(--color-warning)]'
                  : 'text-[var(--color-text-muted)]'
            }`}
          >
            ⏱ {formatTime(secondsLeft)}
          </span>
        )}
      </div>
      {promptText && (
        <div className="min-w-0 text-sm text-[var(--color-text)] [&_.prose]:text-sm [&_.prose_p]:!text-sm [&_.prose_p]:my-1 [&_[data-streamdown='code-block']]:my-2">
          <MarkdownContent content={promptText} />
        </div>
      )}
    </div>
  );
});

export default PromptMessage;
export { getPromptBannerText };
