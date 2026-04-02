import { memo } from 'react';
import type { PromptData } from '../../types';
import MarkdownContent from '../MarkdownContent';
import CollapsibleSection from '../CollapsibleSection';

type Props = {
  prompt: PromptData;
  secondsLeft: number | null;
};

const PromptMessage = memo(function PromptMessage({
  prompt,
  secondsLeft,
}: Props): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center gap-2 mb-3">
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
      {prompt.message.split('\n').length > 10 ? (
        <CollapsibleSection
          title="Full message"
          defaultOpen
          borderColor="#5599dd"
        >
          <div className="prose prose-invert prose-sm max-w-none">
            <MarkdownContent content={prompt.message} />
          </div>
        </CollapsibleSection>
      ) : (
        <div className="msg-agent pl-3 py-2">
          <div className="prose prose-invert prose-sm max-w-none">
            <MarkdownContent content={prompt.message} />
          </div>
        </div>
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
