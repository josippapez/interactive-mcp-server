import { memo } from 'react';
import type { PromptData } from '../../types';

type Props = {
  prompt: PromptData;
  secondsLeft: number | null;
};

const PromptMessage = memo(function PromptMessage({
  prompt,
  secondsLeft,
}: Props): React.ReactElement | null {
  if (!prompt.projectName && secondsLeft === null) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      {prompt.projectName && (
        <span className="px-1.5 py-0.5 rounded-sm bg-[var(--color-agent)]/10 text-[var(--color-agent)] text-xs">
          {prompt.projectName}
        </span>
      )}
      {secondsLeft !== null && (
        <span
          className={`ml-auto px-1.5 py-0.5 rounded-sm text-xs font-mono ${
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
  );
});

export default PromptMessage;

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
